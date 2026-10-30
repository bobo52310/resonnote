import { describe, expect, it } from 'vitest';
import { buildHtml } from '../../src/export/html';
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

const IMG = 'data:image/jpeg;base64,AAAA';

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('buildHtml', () => {
  it('is a zh-TW, phone-friendly, self-contained document', () => {
    const html = buildHtml('造山者', [makeNote('a')], new Map([['a', IMG]]));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="zh-TW">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<script/i);
  });

  it('renders one article per note with image, time, subtitle, body and Netflix link', () => {
    const html = buildHtml('造山者', [makeNote('a')], new Map([['a', IMG]]));
    expect(count(html, '<article')).toBe(1);
    expect(html).toContain(`src="${IMG}"`);
    expect(html).toContain('16:43');
    expect(html).toContain('這通電話 為台灣走向科技之路開了一扇窗');
    expect(html).toContain('心得文字');
    expect(html).toContain('href="https://www.netflix.com/watch/83053998?t=1003"');
    expect(html).toContain('在 Netflix 從 16:43 開始看');
    expect(html).toContain('data:image/jpeg');
  });

  it('links a YouTube note to the video at that second, with the text for it', () => {
    const note = makeNote('y', { platform: 'youtube', videoId: 'arj7oStGLkU' });
    const html = buildHtml('t', [note], new Map());
    // The & of the link is escaped inside the attribute.
    expect(html).toContain('href="https://www.youtube.com/watch?v=arj7oStGLkU&amp;t=1003s"');
    expect(html).toContain('>在 YouTube 從 16:43 開始看</a>');
    expect(html).not.toContain('netflix.com');
  });

  it('links a Disney+ note to the title without a time and says where the moment is', () => {
    const id = '4b3a1c2e-9f00-4d6b-8a21-0123456789ab';
    const html = buildHtml('t', [makeNote('d', { platform: 'disney', videoId: id })], new Map());
    expect(html).toContain(`href="https://www.disneyplus.com/play/${id}"`);
    expect(html).toContain('>在 Disney+ 打開（這一刻在 16:43）</a>');
    expect(html).not.toContain('netflix.com');
  });

  it('uses each note own platform when one page mixes platforms', () => {
    const notes = [
      makeNote('n'),
      makeNote('y', { platform: 'youtube', videoId: 'arj7oStGLkU', title: '別的片' }),
    ];
    const html = buildHtml('三則', notes, new Map());
    expect(html).toContain('在 Netflix 從 16:43 開始看');
    expect(html).toContain('在 YouTube 從 16:43 開始看');
    expect(count(html, 'class="watch"')).toBe(2);
  });

  it('renders as many articles as notes', () => {
    const notes = [makeNote('a'), makeNote('b', { timeMs: 5000 }), makeNote('c', { title: '別部' })];
    const html = buildHtml('三則', notes, new Map());
    expect(count(html, '<article')).toBe(3);
  });

  it('omits <img> for a note without an image', () => {
    const html = buildHtml('造山者', [makeNote('a')], new Map());
    expect(html).not.toContain('<img');
  });

  it('only renders an image for a note that has a data url', () => {
    const notes = [makeNote('a'), makeNote('b', { timeMs: 5000 })];
    const html = buildHtml('造山者', notes, new Map([['a', IMG]]));
    expect(count(html, '<img')).toBe(1);
  });

  it('omits the subtitle and body blocks when empty', () => {
    const html = buildHtml('造山者', [makeNote('a', { subtitle: '', body: '' })], new Map());
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('class="body"');
  });

  it('escapes user text in body, subtitle, title, heading and episode title', () => {
    const html = buildHtml(
      '<script>t</script>',
      [
        makeNote('a', {
          title: '<b>T</b>',
          episodeTitle: '"E" & \'F\'',
          subtitle: '<img src=x onerror=alert(1)>',
          body: '<script>x</script>',
        }),
      ],
      new Map(),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>T</b>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;T&lt;/b&gt;');
    expect(html).toContain('&quot;E&quot; &amp; &#39;F&#39;');
    expect(html).toContain('<title>&lt;script&gt;t&lt;/script&gt;</title>');
  });

  it('does not let an image value break out of the src attribute', () => {
    const evil = 'data:image/jpeg;base64,AAAA" onerror="alert(1)';
    const html = buildHtml('t', [makeNote('a')], new Map([['a', evil]]));
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it('ignores image values that are not image data urls', () => {
    const html = buildHtml('t', [makeNote('a')], new Map([['a', 'https://evil.example/x.jpg']]));
    expect(html).not.toContain('<img');
  });

  it('keeps line breaks of the subtitle and body visible', () => {
    const html = buildHtml('t', [makeNote('a', { body: '一\n二' })], new Map());
    expect(html).toContain('white-space: pre-wrap');
    expect(html).toContain('一\n二');
  });

  it('shows group headings unless a lone group repeats the page title', () => {
    const same = buildHtml('造山者－世紀的賭注', [makeNote('a')], new Map());
    expect(same).not.toContain('<h2>');

    const other = buildHtml('我的筆記', [makeNote('a')], new Map());
    expect(other).toContain('<h2>造山者－世紀的賭注</h2>');

    const two = buildHtml(
      '兩部',
      [makeNote('a'), makeNote('b', { title: '黑暗榮耀' })],
      new Map(),
    );
    expect(count(two, '<h2>')).toBe(2);
  });

  it('sorts notes by time inside a heading group', () => {
    const notes = [
      makeNote('b', { timeMs: 90_000, body: '後面' }),
      makeNote('a', { timeMs: 30_000, body: '前面' }),
    ];
    const html = buildHtml('t', notes, new Map());
    expect(html.indexOf('前面')).toBeLessThan(html.indexOf('後面'));
  });
});
