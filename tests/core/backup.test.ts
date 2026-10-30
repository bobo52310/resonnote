import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  BackupFormatError,
  createBackupZip,
  exportAllBackup,
  getLastBackupAt,
  mergeNotes,
  needsBackupReminder,
  parseBackupZip,
  restoreBackup,
  setLastBackupAt,
} from '../../src/core/backup';
import { closeDb, getImage, getNote, listNotes, putImage, putNote } from '../../src/core/db';
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

function jpeg(...tail: number[]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...tail]);
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  fakeBrowser.reset();
});

describe('createBackupZip / parseBackupZip', () => {
  it('round-trips notes and image bytes', () => {
    const notes = [
      makeNote('a', { season: 1, episode: 2, episodeTitle: '第二集' }),
      makeNote('b', { image: { source: 'none', width: 0, height: 0 } }),
    ];
    const images = new Map([['a', jpeg(1, 2, 3, 4, 5)]]);

    const parsed = parseBackupZip(createBackupZip(notes, images));

    expect(parsed.notes).toEqual(notes);
    expect([...parsed.images.keys()]).toEqual(['a']);
    expect(Array.from(parsed.images.get('a')!)).toEqual(Array.from(images.get('a')!));
  });

  it('stores notes.json as { version: 1, notes } and images under images/<id>.jpg', () => {
    const files = unzipSync(createBackupZip([makeNote('a')], new Map([['a', jpeg(9)]])));

    expect(Object.keys(files).sort()).toEqual(['images/a.jpg', 'notes.json']);
    expect(JSON.parse(strFromU8(files['notes.json']!))).toEqual({
      version: 1,
      notes: [makeNote('a')],
    });
  });

  it('returns image bytes that do not alias the input buffer', () => {
    const zip = createBackupZip([makeNote('a')], new Map([['a', jpeg(7, 7, 7)]]));
    const parsed = parseBackupZip(zip);
    const image = parsed.images.get('a')!;

    expect(image.buffer.byteLength).toBe(image.byteLength);
    zip.fill(0);
    expect(Array.from(image)).toEqual(Array.from(jpeg(7, 7, 7)));
  });

  it('throws BackupFormatError when notes.json is missing', () => {
    const zip = zipSync({ 'x.txt': strToU8('hello') });
    expect(() => parseBackupZip(zip)).toThrow(BackupFormatError);
  });

  it('throws BackupFormatError when the data is not a zip at all', () => {
    expect(() => parseBackupZip(strToU8('definitely not a zip'))).toThrow(BackupFormatError);
  });

  it('throws BackupFormatError when notes.json is not valid JSON', () => {
    const zip = zipSync({ 'notes.json': strToU8('{ nope') });
    expect(() => parseBackupZip(zip)).toThrow(BackupFormatError);
  });

  it('throws BackupFormatError for an unsupported version or a malformed notes list', () => {
    const wrongVersion = zipSync({ 'notes.json': strToU8(JSON.stringify({ version: 2, notes: [] })) });
    const notAnArray = zipSync({ 'notes.json': strToU8(JSON.stringify({ version: 1, notes: {} })) });
    const badNote = zipSync({
      'notes.json': strToU8(JSON.stringify({ version: 1, notes: [{ id: 'a' }] })),
    });
    const badDate = zipSync({
      'notes.json': strToU8(
        JSON.stringify({ version: 1, notes: [makeNote('a', { updatedAt: 'yesterday' })] }),
      ),
    });

    expect(() => parseBackupZip(wrongVersion)).toThrow(BackupFormatError);
    expect(() => parseBackupZip(notAnArray)).toThrow(BackupFormatError);
    expect(() => parseBackupZip(badNote)).toThrow(BackupFormatError);
    expect(() => parseBackupZip(badDate)).toThrow(BackupFormatError);
  });
});

describe('parseBackupZip note validation', () => {
  /** Zips a notes.json whose single note is `makeNote('a')` with `patch` applied after serializing. */
  function zipWithRawNote(patch: (raw: Record<string, unknown>) => void): Uint8Array {
    const raw = JSON.parse(JSON.stringify(makeNote('a', { season: 1, episode: 2, episodeTitle: 'E' })));
    patch(raw);
    return zipSync({ 'notes.json': strToU8(JSON.stringify({ version: 1, notes: [raw] })) });
  }

  it('accepts every known platform and keeps it', () => {
    for (const platform of ['netflix', 'youtube', 'disney'] as const) {
      const note = makeNote('a', { platform, videoId: platform === 'youtube' ? 'arj7oStGLkU' : '1' });
      expect(parseBackupZip(createBackupZip([note], new Map())).notes).toEqual([note]);
    }
  });

  it.each([['hulu'], ['Netflix'], ['disney+'], [''], ['toString'], [1], [null]])(
    'rejects an unknown platform (%j)',
    (platform) => {
      const zip = zipWithRawNote((raw) => (raw.platform = platform));
      expect(() => parseBackupZip(zip)).toThrow(BackupFormatError);
    },
  );

  it('rejects a note without a platform', () => {
    const zip = zipWithRawNote((raw) => delete raw.platform);
    expect(() => parseBackupZip(zip)).toThrow(BackupFormatError);
  });

  it('rejects an image.source outside tab | frame | trickplay | none', () => {
    const zip = zipWithRawNote((raw) => ((raw.image as Record<string, unknown>).source = 'screen'));
    expect(() => parseBackupZip(zip)).toThrow(BackupFormatError);
  });

  it('accepts every valid image.source, frame included', () => {
    for (const source of ['tab', 'frame', 'trickplay', 'none'] as const) {
      const note = makeNote('a', { image: { source, width: 1, height: 1 } });
      expect(parseBackupZip(createBackupZip([note], new Map())).notes).toEqual([note]);
    }
  });

  it('rejects a non-numeric season or episode', () => {
    const badSeason = zipWithRawNote((raw) => (raw.season = 'x'));
    const badEpisode = zipWithRawNote((raw) => (raw.episode = '2'));
    expect(() => parseBackupZip(badSeason)).toThrow(BackupFormatError);
    expect(() => parseBackupZip(badEpisode)).toThrow(BackupFormatError);
  });

  it('rejects a non-string episodeTitle', () => {
    const zip = zipWithRawNote((raw) => (raw.episodeTitle = 7));
    expect(() => parseBackupZip(zip)).toThrow(BackupFormatError);
  });

  it('rejects a non-finite image width or height', () => {
    // JSON.stringify turns NaN and Infinity into null, which is what a corrupt file would hold.
    const nullWidth = zipWithRawNote((raw) => ((raw.image as Record<string, unknown>).width = null));
    const stringHeight = zipWithRawNote(
      (raw) => ((raw.image as Record<string, unknown>).height = '720'),
    );
    expect(() => parseBackupZip(nullWidth)).toThrow(BackupFormatError);
    expect(() => parseBackupZip(stringHeight)).toThrow(BackupFormatError);
    expect(() =>
      parseBackupZip(createBackupZip([makeNote('a', { image: { source: 'tab', width: NaN, height: 720 } })], new Map())),
    ).toThrow(BackupFormatError);
  });

  it('accepts a note without the optional season, episode and episodeTitle', () => {
    const note = makeNote('a');
    expect(parseBackupZip(createBackupZip([note], new Map())).notes).toEqual([note]);
  });

  it('drops unknown keys from notes and from the image object', async () => {
    const zip = zipWithRawNote((raw) => {
      raw.evil = 'payload';
      (raw.image as Record<string, unknown>).extra = true;
    });

    const [note] = parseBackupZip(zip).notes;

    expect(note).toEqual(makeNote('a', { season: 1, episode: 2, episodeTitle: 'E' }));
    expect(Object.keys(note!)).not.toContain('evil');
    expect(Object.keys(note!.image)).toEqual(['source', 'width', 'height']);

    await restoreBackup(zip);
    const stored = (await getNote('a')) as unknown as Record<string, unknown>;
    expect(stored.evil).toBeUndefined();
    expect('evil' in stored).toBe(false);
  });
});

describe('mergeNotes', () => {
  const older = '2026-10-28T10:00:00.000Z';
  const newer = '2026-10-28T11:00:00.000Z';

  it('does not write an incoming note that is older than the existing one', () => {
    const existing = [makeNote('a', { updatedAt: newer })];
    expect(mergeNotes(existing, [makeNote('a', { updatedAt: older })])).toEqual([]);
  });

  it('does not write an incoming note with the same updatedAt', () => {
    const existing = [makeNote('a', { updatedAt: older })];
    expect(mergeNotes(existing, [makeNote('a', { updatedAt: older })])).toEqual([]);
  });

  it('writes an incoming note that is newer than the existing one', () => {
    const existing = [makeNote('a', { updatedAt: older, body: 'old' })];
    const incoming = makeNote('a', { updatedAt: newer, body: 'new' });
    expect(mergeNotes(existing, [incoming])).toEqual([incoming]);
  });

  it('writes an incoming note whose id is new', () => {
    const existing = [makeNote('a')];
    const incoming = makeNote('b');
    expect(mergeNotes(existing, [incoming])).toEqual([incoming]);
  });

  it('keeps only the newest copy when the incoming list repeats an id', () => {
    const first = makeNote('a', { updatedAt: older, body: 'first' });
    const second = makeNote('a', { updatedAt: newer, body: 'second' });
    expect(mergeNotes([], [second, first])).toEqual([second]);
    expect(mergeNotes([], [first, second])).toEqual([second]);
  });
});

describe('restoreBackup', () => {
  it('restoring the same backup twice does not duplicate', async () => {
    const notes = [makeNote('a'), makeNote('b')];
    const zip = createBackupZip(notes, new Map([['a', jpeg(1)], ['b', jpeg(2)]]));

    const first = await restoreBackup(zip);
    const second = await restoreBackup(zip);

    expect(first).toEqual({ written: 2, skipped: 0 });
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await listNotes()).toHaveLength(2);
  });

  it('restores notes of every platform, including a YouTube frame picture', async () => {
    const youtube = makeNote('y', {
      platform: 'youtube',
      videoId: 'arj7oStGLkU',
      image: { source: 'frame', width: 1920, height: 1080 },
    });
    const disney = makeNote('d', { platform: 'disney', videoId: '4b3a1c2e-9f00-4d6b-8a21-0123456789ab' });

    const result = await restoreBackup(
      createBackupZip([youtube, disney, makeNote('n')], new Map([['y', jpeg(4, 5)]])),
    );

    expect(result).toEqual({ written: 3, skipped: 0 });
    expect(await getNote('y')).toEqual(youtube);
    expect(await getNote('d')).toEqual(disney);
    expect(new Uint8Array((await getImage('y'))!)).toEqual(jpeg(4, 5));
  });

  it('imports a note whose image is missing', async () => {
    const zip = createBackupZip(
      [makeNote('a'), makeNote('b')],
      new Map([['a', jpeg(1, 2, 3)]]),
    );

    const result = await restoreBackup(zip);

    expect(result).toEqual({ written: 2, skipped: 0 });
    expect(await getNote('b')).toEqual(makeNote('b'));
    expect(await getImage('b')).toBeUndefined();
    expect(new Uint8Array((await getImage('a'))!)).toEqual(jpeg(1, 2, 3));
  });

  it('overwrites an older local note and its image with a newer backup copy', async () => {
    await putNote(makeNote('a', { body: 'old', updatedAt: '2026-10-28T10:00:00.000Z' }));
    await putImage('a', toBuffer(jpeg(1)));
    const incoming = makeNote('a', { body: 'new', updatedAt: '2026-10-28T11:00:00.000Z' });

    const result = await restoreBackup(createBackupZip([incoming], new Map([['a', jpeg(2)]])));

    expect(result).toEqual({ written: 1, skipped: 0 });
    expect(await getNote('a')).toEqual(incoming);
    expect(new Uint8Array((await getImage('a'))!)).toEqual(jpeg(2));
  });

  it('keeps a newer local note and its image when the backup copy is older', async () => {
    const local = makeNote('a', { body: 'local', updatedAt: '2026-10-28T11:00:00.000Z' });
    await putNote(local);
    await putImage('a', toBuffer(jpeg(1)));
    const incoming = makeNote('a', { body: 'backup', updatedAt: '2026-10-28T10:00:00.000Z' });

    const result = await restoreBackup(createBackupZip([incoming], new Map([['a', jpeg(2)]])));

    expect(result).toEqual({ written: 0, skipped: 1 });
    expect(await getNote('a')).toEqual(local);
    expect(new Uint8Array((await getImage('a'))!)).toEqual(jpeg(1));
  });

  it('keeps the local image when a newer backup copy has no image', async () => {
    await putNote(makeNote('a', { updatedAt: '2026-10-28T10:00:00.000Z' }));
    await putImage('a', toBuffer(jpeg(1)));
    const incoming = makeNote('a', { body: 'edited', updatedAt: '2026-10-28T11:00:00.000Z' });

    await restoreBackup(createBackupZip([incoming], new Map()));

    expect((await getNote('a'))?.body).toBe('edited');
    expect(new Uint8Array((await getImage('a'))!)).toEqual(jpeg(1));
  });

  it('does not store images that belong to no note', async () => {
    await restoreBackup(createBackupZip([makeNote('a')], new Map([['ghost', jpeg(5)]])));
    expect(await getImage('ghost')).toBeUndefined();
  });

  it('rejects a malformed backup without touching the database', async () => {
    await expect(restoreBackup(zipSync({ 'x.txt': strToU8('hi') }))).rejects.toBeInstanceOf(
      BackupFormatError,
    );
    expect(await listNotes()).toEqual([]);
  });
});

describe('exportAllBackup', () => {
  it('exports every note and every stored image', async () => {
    await putNote(makeNote('a'));
    await putNote(makeNote('b'));
    await putImage('a', toBuffer(jpeg(1, 2, 3)));

    const parsed = parseBackupZip(await exportAllBackup());

    expect(parsed.notes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect([...parsed.images.keys()]).toEqual(['a']);
    expect(Array.from(parsed.images.get('a')!)).toEqual(Array.from(jpeg(1, 2, 3)));
  });

  it('produces an empty but valid backup when there are no notes', async () => {
    const parsed = parseBackupZip(await exportAllBackup());
    expect(parsed.notes).toEqual([]);
    expect(parsed.images.size).toBe(0);
  });
});

describe('lastBackupAt', () => {
  it('is null before any backup is recorded', async () => {
    expect(await getLastBackupAt()).toBeNull();
  });

  it('returns what setLastBackupAt stored', async () => {
    await setLastBackupAt('2026-10-28T12:00:00.000Z');
    expect(await getLastBackupAt()).toBe('2026-10-28T12:00:00.000Z');
  });

  it('stores under the lastBackupAt key', async () => {
    await setLastBackupAt('2026-10-28T12:00:00.000Z');
    expect(await fakeBrowser.storage.local.get('lastBackupAt')).toEqual({
      lastBackupAt: '2026-10-28T12:00:00.000Z',
    });
  });
});

describe('needsBackupReminder', () => {
  const now = new Date('2026-10-28T12:00:00.000Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

  it('is true when there has never been a backup', () => {
    expect(needsBackupReminder(null, now)).toBe(true);
  });

  it('is false 13 days after the last backup', () => {
    expect(needsBackupReminder(daysAgo(13), now)).toBe(false);
  });

  it('is false exactly 14 days after the last backup', () => {
    expect(needsBackupReminder(daysAgo(14), now)).toBe(false);
  });

  it('is true 15 days after the last backup', () => {
    expect(needsBackupReminder(daysAgo(15), now)).toBe(true);
  });

  it('is true when the stored value is not a date', () => {
    expect(needsBackupReminder('garbage', now)).toBe(true);
  });
});
