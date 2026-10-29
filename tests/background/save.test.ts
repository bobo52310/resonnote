import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSave, handleUpdate } from '../../src/background/save';
import { closeDb, getImage, getNote, listNotes } from '../../src/core/db';
import { bytesToDataUrl, dataUrlToBytes, type ToBackground } from '../../src/core/messages';
import type { Note } from '../../src/core/types';

type SaveMessage = Extract<ToBackground, { type: 'scenenote/save' }>;

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    platform: 'netflix',
    videoId: '83053998',
    title: '造山者',
    timeMs: 1003469,
    subtitle: '你好嗎',
    body: '好看',
    image: { source: 'tab', width: 2560, height: 1440 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 255]);

function toDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function msg(note: Note, imageDataUrl: string | null): SaveMessage {
  return { type: 'scenenote/save', note, imageDataUrl };
}

describe('handleSave', () => {
  it('stores the note and its image bytes', async () => {
    const note = makeNote();
    expect(await handleSave(msg(note, toDataUrl(BYTES)))).toEqual({ ok: true });

    expect(await getNote('note-1')).toEqual(note);
    const image = await getImage('note-1');
    expect(image).toBeDefined();
    expect(Array.from(new Uint8Array(image!))).toEqual(Array.from(BYTES));
  });

  it('stores no image when imageDataUrl is null', async () => {
    const note = makeNote({ image: { source: 'none', width: 0, height: 0 } });
    expect(await handleSave(msg(note, null))).toEqual({ ok: true });
    expect(await getNote('note-1')).toEqual(note);
    expect(await getImage('note-1')).toBeUndefined();
  });

  it('overwrites the same note on a retry instead of duplicating it', async () => {
    await handleSave(msg(makeNote({ body: 'first' }), toDataUrl(BYTES)));
    await handleSave(msg(makeNote({ body: 'second' }), toDataUrl(BYTES)));
    const all = await listNotes();
    expect(all).toHaveLength(1);
    expect(all[0]?.body).toBe('second');
  });

  it('reports a database failure instead of throwing', async () => {
    const failing = { open: () => { throw new Error('quota exceeded'); } };
    await closeDb();
    globalThis.indexedDB = failing as unknown as IDBFactory;
    const result = await handleSave(msg(makeNote(), toDataUrl(BYTES)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('quota exceeded');
  });

  it('reports an image that is not a base64 data URL, and writes no note', async () => {
    const result = await handleSave(msg(makeNote(), 'blob:https://www.netflix.com/abc'));
    expect(result.ok).toBe(false);
    expect(await getNote('note-1')).toBeUndefined();
  });
});

describe('data URL codec', () => {
  it('round-trips bytes larger than one encoding chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    const url = bytesToDataUrl(bytes);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(dataUrlToBytes(url)).toEqual(bytes);
  });

  it('accepts a mime type with parameters and rejects anything that is not base64', () => {
    expect(dataUrlToBytes('data:image/jpeg;charset=binary;base64,/9g=')).toEqual(
      new Uint8Array([0xff, 0xd8]),
    );
    expect(() => dataUrlToBytes('data:text/plain,hello')).toThrow();
    expect(() => dataUrlToBytes('')).toThrow();
  });
});

describe('handleUpdate', () => {
  it('stores the new subtitle and thoughts and moves updatedAt on', async () => {
    await handleSave(msg(makeNote(), null));
    const result = await handleUpdate(
      { type: 'scenenote/update', id: 'note-1', subtitle: '新台詞  ', body: '改過的心得\n\n' },
      () => new Date('2026-10-29T08:00:00.000Z'),
    );
    expect(result).toEqual({ ok: true });
    const stored = await getNote('note-1');
    expect(stored).toMatchObject({ subtitle: '新台詞', body: '改過的心得', title: '造山者', timeMs: 1003469 });
    expect(stored?.updatedAt).toBe('2026-10-29T08:00:00.000Z');
    expect(stored?.createdAt).toBe('2026-10-28T10:00:00.000Z');
  });

  it('fails without creating anything for an unknown note', async () => {
    const result = await handleUpdate({ type: 'scenenote/update', id: 'missing', subtitle: '', body: '' });
    expect(result).toEqual({ ok: false, error: '找不到這則筆記' });
    expect(await listNotes()).toEqual([]);
  });
});
