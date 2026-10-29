import { describe, expect, it } from 'vitest';
import type { Note } from '../../src/core/types';
import { groupNotes } from '../../src/notebook/group';

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '81234567',
    title: '黑暗榮耀',
    timeMs: 60_000,
    subtitle: '',
    body: '',
    image: { source: 'tab', width: 1280, height: 720 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

describe('groupNotes', () => {
  it('returns no groups for no notes', () => {
    expect(groupNotes([])).toEqual([]);
  });

  it('groups notes by videoId and carries the heading', () => {
    const groups = groupNotes([
      makeNote('a', { videoId: '1', title: '甲', season: 1, episode: 2, episodeTitle: '開場' }),
      makeNote('b', { videoId: '2', title: '乙' }),
      makeNote('c', { videoId: '1', title: '甲', season: 1, episode: 2, episodeTitle: '開場' }),
    ]);
    expect(groups.map((g) => g.videoId).sort()).toEqual(['1', '2']);
    const first = groups.find((g) => g.videoId === '1');
    expect(first?.heading).toBe('甲 第1季第2集 開場');
    expect(first?.notes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(groups.find((g) => g.videoId === '2')?.heading).toBe('乙');
  });

  it('keeps the same id string on different platforms in separate groups', () => {
    // 11 digits is a valid id on both Netflix and YouTube.
    const groups = groupNotes([
      makeNote('n', { platform: 'netflix', videoId: '12345678901', title: 'Netflix 的片' }),
      makeNote('y', {
        platform: 'youtube',
        videoId: '12345678901',
        title: 'YouTube 的片',
        createdAt: '2026-10-28T11:00:00.000Z',
      }),
      makeNote('d', {
        platform: 'disney',
        videoId: '12345678901',
        title: 'Disney+ 的片',
        createdAt: '2026-10-28T09:00:00.000Z',
      }),
      makeNote('y2', {
        platform: 'youtube',
        videoId: '12345678901',
        title: 'YouTube 的片',
        timeMs: 5000,
      }),
    ]);
    expect(groups.map((g) => [g.platform, g.videoId, g.heading])).toEqual([
      ['youtube', '12345678901', 'YouTube 的片'],
      ['netflix', '12345678901', 'Netflix 的片'],
      ['disney', '12345678901', 'Disney+ 的片'],
    ]);
    expect(groups[0]?.notes.map((n) => n.id)).toEqual(['y2', 'y']);
    expect(groups[1]?.notes.map((n) => n.id)).toEqual(['n']);
  });

  it('carries the platform of the notes in each group', () => {
    const [group] = groupNotes([makeNote('a', { platform: 'disney', videoId: 'u-1' })]);
    expect(group?.platform).toBe('disney');
  });

  it('keeps different episodes of one show apart because they have different videoIds', () => {
    const groups = groupNotes([
      makeNote('a', { videoId: '1', title: '劇', episode: 1 }),
      makeNote('b', { videoId: '2', title: '劇', episode: 2 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('orders groups by their newest createdAt, newest first', () => {
    const groups = groupNotes([
      makeNote('old', { videoId: 'old', createdAt: '2026-10-01T00:00:00.000Z' }),
      makeNote('mid-1', { videoId: 'mid', createdAt: '2026-10-10T00:00:00.000Z' }),
      // 'mid' has a note from Oct 10 and a newer one from Oct 20, so it outranks 'new'
      makeNote('mid-2', { videoId: 'mid', createdAt: '2026-10-20T00:00:00.000Z' }),
      makeNote('new', { videoId: 'new', createdAt: '2026-10-15T00:00:00.000Z' }),
    ]);
    expect(groups.map((g) => g.videoId)).toEqual(['mid', 'new', 'old']);
  });

  it('orders notes inside a group by timeMs ascending', () => {
    const [group] = groupNotes([
      makeNote('late', { timeMs: 900_000 }),
      makeNote('early', { timeMs: 5_000 }),
      makeNote('middle', { timeMs: 300_000 }),
    ]);
    expect(group?.notes.map((n) => n.id)).toEqual(['early', 'middle', 'late']);
  });

  it('breaks timeMs ties by createdAt so the order is stable', () => {
    const [group] = groupNotes([
      makeNote('second', { timeMs: 1000, createdAt: '2026-10-28T11:00:00.000Z' }),
      makeNote('first', { timeMs: 1000, createdAt: '2026-10-28T10:00:00.000Z' }),
    ]);
    expect(group?.notes.map((n) => n.id)).toEqual(['first', 'second']);
  });

  it('compares createdAt as instants, not as text', () => {
    const groups = groupNotes([
      makeNote('a', { videoId: 'a', createdAt: '2026-10-28T09:00:00.000Z' }),
      // 08:00 at UTC-02:00 is 10:00Z, later than 09:00Z even though the text sorts earlier
      makeNote('b', { videoId: 'b', createdAt: '2026-10-28T08:00:00.000-02:00' }),
    ]);
    expect(groups.map((g) => g.videoId)).toEqual(['b', 'a']);
  });

  it('does not mutate the input', () => {
    const input = [makeNote('b', { timeMs: 2 }), makeNote('a', { timeMs: 1 })];
    const snapshot = input.map((n) => n.id);
    groupNotes(input);
    expect(input.map((n) => n.id)).toEqual(snapshot);
  });
});
