import { describe, expect, it } from 'vitest';
import { formatTime, noteHeading, safeFileName } from '../../src/core/format';

describe('formatTime', () => {
  it('formats minutes and seconds, flooring to the second', () => {
    expect(formatTime(1003469)).toBe('16:43');
  });

  it('formats zero as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('adds an hour part when needed', () => {
    expect(formatTime(3963000)).toBe('1:06:03');
  });
});

describe('noteHeading', () => {
  it('returns just the title for a movie', () => {
    expect(noteHeading({ title: '造山者－世紀的賭注' })).toBe('造山者－世紀的賭注');
  });

  it('appends season, episode and episode title for a series', () => {
    expect(noteHeading({ title: '新手上路', season: 1, episode: 2, episodeTitle: 'B' })).toBe(
      '新手上路 第1季第2集 B',
    );
  });

  it('omits the episode title when missing', () => {
    expect(noteHeading({ title: '新手上路', season: 1, episode: 2 })).toBe('新手上路 第1季第2集');
  });
});

describe('safeFileName', () => {
  it('replaces characters that are illegal in file names', () => {
    expect(safeFileName('a/b:c*?"<>|')).toBe('a_b_c______');
  });

  it('falls back to untitled for blank input', () => {
    expect(safeFileName('   ')).toBe('untitled');
  });

  it('truncates to 80 characters', () => {
    expect(safeFileName('字'.repeat(100))).toHaveLength(80);
  });
});
