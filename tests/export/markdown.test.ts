import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildMarkdown, buildMarkdownZip } from '../../src/export/markdown';
import type { Note } from '../../src/core/types';

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '83053998',
    title: '造山者－世紀的賭注',
    timeMs: 1003469,
    subtitle: '這通電話 為台灣走向科技之路開了一扇窗',
    body: '心得文字',
    image: { source: 'tab', width: 1280, height: 720 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

const always = () => true;
const never = () => false;

describe('buildMarkdown', () => {
  it('renders one note exactly as specified', () => {
    const md = buildMarkdown([makeNote('abc')], always);
    expect(md).toBe(
      [
        '# 造山者－世紀的賭注',
        '',
        '## 16:43',
        '',
        '![16:43](images/abc.jpg)',
        '',
        '> 這通電話 為台灣走向科技之路開了一扇窗',
        '',
        '心得文字',
        '',
        '[在 Netflix 從 16:43 開始看](https://www.netflix.com/watch/83053998?t=1003)',
        '',
      ].join('\n'),
    );
  });

  it('omits the image line when the note has no image', () => {
    const md = buildMarkdown([makeNote('abc')], never);
    expect(md).not.toContain('![');
    expect(md).toContain('> 這通電話');
  });

  it('omits the quote line when there is no subtitle', () => {
    const md = buildMarkdown([makeNote('abc', { subtitle: '' })], always);
    expect(md).not.toContain('>');
    expect(md).toContain('心得文字');
  });

  it('omits the body line when there is no body', () => {
    const md = buildMarkdown([makeNote('abc', { body: '' })], always);
    expect(md).not.toContain('心得文字');
    expect(md).toBe(
      [
        '# 造山者－世紀的賭注',
        '',
        '## 16:43',
        '',
        '![16:43](images/abc.jpg)',
        '',
        '> 這通電話 為台灣走向科技之路開了一扇窗',
        '',
        '[在 Netflix 從 16:43 開始看](https://www.netflix.com/watch/83053998?t=1003)',
        '',
      ].join('\n'),
    );
  });

  it('keeps only the heading, time and link for a bare note', () => {
    const md = buildMarkdown([makeNote('abc', { subtitle: '', body: '' })], never);
    expect(md).toBe(
      [
        '# 造山者－世紀的賭注',
        '',
        '## 16:43',
        '',
        '[在 Netflix 從 16:43 開始看](https://www.netflix.com/watch/83053998?t=1003)',
        '',
      ].join('\n'),
    );
  });

  it('prefixes every line of a multi-line subtitle with a quote marker', () => {
    const md = buildMarkdown([makeNote('abc', { subtitle: '第一行\n第二行' })], never);
    expect(md).toContain('> 第一行\n> 第二行\n');
  });

  it('groups by heading and sorts each group by time', () => {
    const notes = [
      makeNote('b2', { timeMs: 90_000, body: 'B 後' }),
      makeNote('a1', { title: '黑暗榮耀', videoId: '1', timeMs: 5_000, body: 'A' }),
      makeNote('b1', { timeMs: 30_000, body: 'B 前' }),
    ];
    const md = buildMarkdown(notes, never);

    const headings = md.split('\n').filter((l) => l.startsWith('# '));
    expect(headings).toEqual(['# 造山者－世紀的賭注', '# 黑暗榮耀']);
    expect(md.indexOf('B 前')).toBeLessThan(md.indexOf('B 後'));
    expect(md.indexOf('B 後')).toBeLessThan(md.indexOf('# 黑暗榮耀'));
    // Single blank line between blocks, one trailing newline.
    expect(md).not.toContain('\n\n\n');
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('puts season and episode into the heading', () => {
    const md = buildMarkdown(
      [makeNote('abc', { title: '黑暗榮耀', season: 1, episode: 3, episodeTitle: '蛻變' })],
      never,
    );
    expect(md.startsWith('# 黑暗榮耀 第1季第3集 蛻變\n')).toBe(true);
  });

  it('returns an empty string for no notes', () => {
    expect(buildMarkdown([], always)).toBe('');
  });
});

function entry(files: Record<string, Uint8Array>, path: string): Uint8Array {
  const found = files[path];
  if (!found) throw new Error(`missing zip entry: ${path}`);
  return found;
}

describe('buildMarkdownZip', () => {
  const jpeg = (...tail: number[]) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...tail]);

  it('contains notes.md and images/<id>.jpg for notes that have an image', () => {
    const notes = [
      makeNote('a', { timeMs: 1000 }),
      makeNote('b', { timeMs: 2000, image: { source: 'none', width: 0, height: 0 } }),
    ];
    const files = unzipSync(buildMarkdownZip(notes, new Map([['a', jpeg(1, 2, 3)]])));

    expect(Object.keys(files).sort()).toEqual(['images/a.jpg', 'notes.md']);
    expect([...entry(files, 'images/a.jpg')]).toEqual([...jpeg(1, 2, 3)]);
    const md = strFromU8(entry(files, 'notes.md'));
    expect(md).toContain('![0:01](images/a.jpg)');
    expect(md).not.toContain('images/b.jpg');
  });

  it('does not link or store images that are missing from the map', () => {
    const files = unzipSync(buildMarkdownZip([makeNote('a')], new Map()));
    expect(Object.keys(files)).toEqual(['notes.md']);
    expect(strFromU8(entry(files, 'notes.md'))).not.toContain('![');
  });

  it('ignores images that belong to no exported note', () => {
    const files = unzipSync(buildMarkdownZip([makeNote('a')], new Map([['zzz', jpeg(9)]])));
    expect(Object.keys(files)).toEqual(['notes.md']);
  });
});
