import { describe, expect, it, vi } from 'vitest';
import { listRecent, type RecentDeps } from '../../src/background/recent';
import type { Note } from '../../src/core/types';

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '83053998',
    title: '造山者',
    timeMs: 1000,
    subtitle: '台詞',
    body: '心得',
    image: { source: 'tab', width: 1280, height: 720 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

function deps(notes: Note[], overrides: Partial<RecentDeps> = {}): RecentDeps {
  return {
    listNotes: vi.fn(async () => notes),
    getImage: vi.fn(async () => new Uint8Array([0xff, 0xd8]).buffer),
    shrink: vi.fn(async () => 'data:image/jpeg;base64,U01BTEw='),
    ...overrides,
  };
}

describe('listRecent', () => {
  it('returns the newest notes of the same video only, newest first, up to the limit', async () => {
    const notes = [
      makeNote('old', { createdAt: '2026-10-28T09:00:00.000Z', timeMs: 100 }),
      makeNote('other', { videoId: '999', createdAt: '2026-10-28T12:00:00.000Z' }),
      makeNote('newest', { createdAt: '2026-10-28T11:00:00.000Z', timeMs: 300 }),
      makeNote('middle', { createdAt: '2026-10-28T10:00:00.000Z', timeMs: 200 }),
    ];
    const result = await listRecent('83053998', 2, deps(notes));
    expect(result.map((n) => n.id)).toEqual(['newest', 'middle']);
    expect(result[0]).toEqual({
      id: 'newest',
      timeMs: 300,
      subtitle: '台詞',
      body: '心得',
      thumb: 'data:image/jpeg;base64,U01BTEw=',
    });
  });

  it('gives no picture to a note without one, or whose picture cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notes = [
      makeNote('none', { image: { source: 'none', width: 0, height: 0 }, createdAt: '2026-10-28T12:00:00.000Z' }),
      makeNote('broken'),
    ];
    const d = deps(notes, { shrink: vi.fn(async () => Promise.reject(new Error('bad jpeg'))) });
    const result = await listRecent('83053998', 2, d);
    expect(result.map((n) => [n.id, n.thumb])).toEqual([
      ['none', null],
      ['broken', null],
    ]);
    expect(d.getImage).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list instead of throwing when the notes cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps([], { listNotes: vi.fn(async () => Promise.reject(new Error('db closed'))) });
    expect(await listRecent('83053998', 2, d)).toEqual([]);
  });
});
