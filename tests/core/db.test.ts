import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  deleteNote,
  getImage,
  getNote,
  listNotes,
  putImage,
  putNote,
  updateNote,
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
