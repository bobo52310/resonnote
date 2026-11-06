import { IDBFactory } from 'fake-indexeddb';
import { openDB, type IDBPDatabase } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeDb,
  DB_NAME,
  DB_VERSION,
  deleteNote,
  getImage,
  getNote,
  listNotes,
  MIGRATIONS,
  openResonNoteDb,
  putImage,
  putNote,
  updateNote,
  type Migration,
} from '../../src/core/db';
import type { Note } from '../../src/core/types';

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '81234567',
    title: '造山者－世紀的賭注',
    timeMs: 1003469,
    subtitle: '一句字幕',
    body: '筆記內容',
    image: { source: 'tab', width: 1280, height: 720 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

describe('notes', () => {
  it('round-trips a note through putNote and getNote', async () => {
    const note = makeNote('a', { season: 1, episode: 2, episodeTitle: '第二集' });
    await putNote(note);
    expect(await getNote('a')).toEqual(note);
  });

  it('returns undefined for a missing note', async () => {
    expect(await getNote('missing')).toBeUndefined();
  });

  it('overwrites a note with the same id', async () => {
    await putNote(makeNote('a', { body: 'old' }));
    await putNote(makeNote('a', { body: 'new' }));
    expect((await getNote('a'))?.body).toBe('new');
    expect(await listNotes()).toHaveLength(1);
  });
});

describe('updateNote', () => {
  it('changes only the given fields and answers with the note as it was before', async () => {
    const note = makeNote('a', { season: 1 });
    await putNote(note);
    const previous = await updateNote('a', { body: '新的', updatedAt: '2026-10-29T00:00:00.000Z' });
    expect(previous).toEqual(note);
    expect(await getNote('a')).toEqual({ ...note, body: '新的', updatedAt: '2026-10-29T00:00:00.000Z' });
  });

  it('ignores fields given as undefined', async () => {
    const note = makeNote('a');
    await putNote(note);
    await updateNote('a', { subtitle: undefined, body: '新的' });
    expect(await getNote('a')).toEqual({ ...note, body: '新的' });
  });

  it('does not create a note that is not stored (deleted elsewhere)', async () => {
    await putNote(makeNote('a'));
    await deleteNote('a');
    expect(await updateNote('a', { body: '晚到的修改' })).toBeUndefined();
    expect(await getNote('a')).toBeUndefined();
    expect(await listNotes()).toEqual([]);
  });

  it('listNotes returns every stored note', async () => {
    await putNote(makeNote('a'));
    await putNote(makeNote('b'));
    await putNote(makeNote('c'));
    const ids = (await listNotes()).map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('listNotes returns an empty array on a fresh database', async () => {
    expect(await listNotes()).toEqual([]);
  });
});

describe('images', () => {
  it('round-trips image bytes', async () => {
    await putImage('a', new Uint8Array([1, 2, 3]).buffer);
    const got = await getImage('a');
    expect(got).toBeDefined();
    expect(Array.from(new Uint8Array(got as ArrayBuffer))).toEqual([1, 2, 3]);
  });

  it('returns undefined for a missing image', async () => {
    expect(await getImage('missing')).toBeUndefined();
  });
});

describe('deleteNote', () => {
  it('removes the note and its image together', async () => {
    await putNote(makeNote('a'));
    await putImage('a', new Uint8Array([9, 9]).buffer);
    await deleteNote('a');
    expect(await getNote('a')).toBeUndefined();
    expect(await getImage('a')).toBeUndefined();
  });

  it('leaves other notes and images untouched', async () => {
    await putNote(makeNote('a'));
    await putNote(makeNote('b'));
    await putImage('a', new Uint8Array([1]).buffer);
    await putImage('b', new Uint8Array([2]).buffer);
    await deleteNote('a');
    expect(await getNote('b')).toBeDefined();
    expect(Array.from(new Uint8Array((await getImage('b')) as ArrayBuffer))).toEqual([2]);
  });

  it('does not throw for an unknown id', async () => {
    await expect(deleteNote('missing')).resolves.toBeUndefined();
  });
});

describe('connection lifecycle', () => {
  it('picks up a fresh IDBFactory after closeDb', async () => {
    await putNote(makeNote('a'));
    await closeDb();
    globalThis.indexedDB = new IDBFactory();
    expect(await listNotes()).toEqual([]);
  });

  it('closeDb is safe to call when no connection was opened', async () => {
    await closeDb();
    await expect(closeDb()).resolves.toBeUndefined();
  });
});

/** Rejects after `ms`, so a regression that hangs an IndexedDB request fails instead of timing out. */
async function within<T>(ms: number, work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

describe('schema', () => {
  it('keeps the database name of the old scenenote project', () => {
    // Renaming it would orphan every note already saved.
    expect(DB_NAME).toBe('scenenote');
  });

  it('creates notes (keyed by id) and images (out-of-line keys) on a fresh database', async () => {
    await putNote(makeNote('a'));
    const db = await openDB(DB_NAME);
    try {
      expect(db.version).toBe(DB_VERSION);
      expect(Array.from(db.objectStoreNames).sort()).toEqual(['images', 'notes']);
      const tx = db.transaction(['notes', 'images'], 'readonly');
      expect(tx.objectStore('notes').keyPath).toBe('id');
      expect(tx.objectStore('notes').autoIncrement).toBe(false);
      expect(tx.objectStore('images').keyPath).toBeNull();
      expect(tx.objectStore('images').autoIncrement).toBe(false);
      await tx.done;
    } finally {
      db.close();
    }
  });

  it('builds the same two stores from the shipped migration list', async () => {
    const db = await openResonNoteDb('shipped', MIGRATIONS);
    try {
      expect(db.version).toBe(MIGRATIONS.length);
      expect(Array.from(db.objectStoreNames).sort()).toEqual(['images', 'notes']);
    } finally {
      db.close();
    }
  });
});

describe('migrations', () => {
  /** A version 1 database written the way the first release did, independent of the module. */
  async function createV1Database(name: string): Promise<void> {
    const db = await openDB(name, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore('notes', { keyPath: 'id' });
        upgrading.createObjectStore('images');
      },
    });
    await db.put('notes', makeNote('a'));
    await db.put('notes', makeNote('b', { videoId: '999' }));
    await db.put('images', new Uint8Array([1, 2, 3]).buffer, 'a');
    db.close();
  }

  it('runs every step, in order, on a fresh database', async () => {
    const ran: number[] = [];
    const steps: Migration[] = [1, 2, 3].map((n) => () => {
      ran.push(n);
    });
    const db = await openResonNoteDb('fresh', steps);
    expect(db.version).toBe(3);
    expect(ran).toEqual([1, 2, 3]);
    db.close();
  });

  it('runs only the steps after the stored version', async () => {
    const ran: number[] = [];
    const steps: Migration[] = [1, 2, 3].map((n) => () => {
      ran.push(n);
    });
    (await openResonNoteDb('partial', steps.slice(0, 2))).close();
    ran.length = 0;
    const db = await openResonNoteDb('partial', steps);
    expect(db.version).toBe(3);
    expect(ran).toEqual([3]);
    db.close();
  });

  it('runs no step when the database is already current', async () => {
    (await openResonNoteDb('current', MIGRATIONS)).close();
    const again = vi.fn<Migration>();
    // One step in the list is version 1, which is the stored version: nothing to upgrade.
    const db = await openResonNoteDb('current', [again]);
    expect(db.version).toBe(1);
    expect(again).not.toHaveBeenCalled();
    db.close();
  });

  it('upgrades a version 1 database to version 2 and keeps its data', async () => {
    await createV1Database('upgrade');
    const [v1] = MIGRATIONS;
    const v1Step = vi.fn<Migration>(v1);
    // Test-only version 2: an index on notes and a store of its own.
    const v2Step = vi.fn<Migration>((db, tx) => {
      tx.objectStore('notes').createIndex('byVideoId', 'videoId');
      db.createObjectStore('extras');
    });

    const db = await openResonNoteDb('upgrade', [v1Step, v2Step]);
    try {
      expect(db.version).toBe(2);
      expect(v1Step).not.toHaveBeenCalled();
      expect(v2Step).toHaveBeenCalledTimes(1);
      expect(Array.from(db.objectStoreNames).sort()).toEqual(['extras', 'images', 'notes']);
      expect((await db.getAll('notes')).map((n) => n.id).sort()).toEqual(['a', 'b']);
      expect(await db.get('notes', 'a')).toEqual(makeNote('a'));
      const image = (await db.get('images', 'a')) as ArrayBuffer;
      expect(Array.from(new Uint8Array(image))).toEqual([1, 2, 3]);
      // The index covers the notes that were already stored. The typed schema knows no index.
      const untyped = db as unknown as IDBPDatabase;
      expect((await untyped.getAllFromIndex('notes', 'byVideoId', '999')).map((n) => n.id)).toEqual(['b']);
    } finally {
      db.close();
    }
  });
});

describe('blocked upgrade', () => {
  it('reports that it waits for a connection that does not close, and goes on once it does', async () => {
    const holder = await openDB('held', 1, {
      upgrade(db) {
        db.createObjectStore('notes', { keyPath: 'id' });
      },
    });
    const blocked = vi.fn();
    const upgrading = openResonNoteDb('held', [MIGRATIONS[0] as Migration, () => {}], { blocked });
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledTimes(1));
    holder.close();
    const db = await within(1000, upgrading, 'the upgrade after the holder closed');
    expect(db.version).toBe(2);
    db.close();
  });
});

describe('versionchange', () => {
  it('closes the connection so a newer version can open, and keeps the data', async () => {
    await putNote(makeNote('a'));
    const upgraded = await within(1000, openDB(DB_NAME, DB_VERSION + 1), 'opening a newer version');
    try {
      expect(upgraded.version).toBe(DB_VERSION + 1);
      expect((await upgraded.get('notes', 'a'))?.id).toBe('a');
    } finally {
      upgraded.close();
    }
  });

  it('resets the cached connection, so the next call opens again instead of reusing a closed one', async () => {
    await putNote(makeNote('a'));
    (await within(1000, openDB(DB_NAME, DB_VERSION + 1), 'opening a newer version')).close();
    // Reusing the closed connection would fail with InvalidStateError. A fresh open at this
    // code's own version is refused because the database has moved on.
    await expect(listNotes()).rejects.toMatchObject({ name: 'VersionError' });
  });

  it('does not cache a failed open: a later call retries', async () => {
    await putNote(makeNote('a'));
    (await within(1000, openDB(DB_NAME, DB_VERSION + 1), 'opening a newer version')).close();
    await expect(listNotes()).rejects.toMatchObject({ name: 'VersionError' });
    globalThis.indexedDB = new IDBFactory();
    expect(await listNotes()).toEqual([]);
  });
});
