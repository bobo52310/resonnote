import { describe, expect, it } from 'vitest';
import type { Platform } from '../../src/core/types';
import {
  detectWatchPage,
  isPlatform,
  PLATFORM_INFO,
  watchLinkText,
} from '../../src/platforms/registry';
import { createManifest } from '../../wxt.config';

const NETFLIX_URL = 'https://www.netflix.com/watch/83053998?t=600';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=arj7oStGLkU&t=60s';
const SHORTS_URL = 'https://www.youtube.com/shorts/arj7oStGLkU';
const DISNEY_URL = 'https://www.disneyplus.com/zh-hant/play/4b3a1c2e-9f00-4d6b-8a21-0123456789ab';

describe('PLATFORM_INFO', () => {
  it('has one entry per platform, keyed by its own id, with the name shown to the user', () => {
    expect(Object.keys(PLATFORM_INFO).sort()).toEqual(['disney', 'netflix', 'youtube']);
    for (const [key, info] of Object.entries(PLATFORM_INFO)) expect(info.id).toBe(key);
    expect(PLATFORM_INFO.netflix.label).toBe('Netflix');
    expect(PLATFORM_INFO.youtube.label).toBe('YouTube');
    expect(PLATFORM_INFO.disney.label).toBe('Disney+');
  });

  it('says which links start playback at the moment', () => {
    expect(PLATFORM_INFO.netflix.linkKeepsTime).toBe(true);
    expect(PLATFORM_INFO.youtube.linkKeepsTime).toBe(true);
    expect(PLATFORM_INFO.disney.linkKeepsTime).toBe(false);
  });

  it('builds each platform link from the video id and the moment', () => {
    expect(PLATFORM_INFO.netflix.watchUrl('83053998', 1_003_469)).toBe(
      'https://www.netflix.com/watch/83053998?t=1003',
    );
    expect(PLATFORM_INFO.youtube.watchUrl('arj7oStGLkU', 1_003_469)).toBe(
      'https://www.youtube.com/watch?v=arj7oStGLkU&t=1003s',
    );
    expect(PLATFORM_INFO.disney.watchUrl('4b3a1c2e-9f00-4d6b-8a21-0123456789ab', 1_003_469)).toBe(
      'https://www.disneyplus.com/play/4b3a1c2e-9f00-4d6b-8a21-0123456789ab',
    );
  });

  it('parses only its own site', () => {
    expect(PLATFORM_INFO.netflix.parseWatchVideoId(NETFLIX_URL)).toBe('83053998');
    expect(PLATFORM_INFO.netflix.parseWatchVideoId(YOUTUBE_URL)).toBeNull();
    expect(PLATFORM_INFO.youtube.parseWatchVideoId(YOUTUBE_URL)).toBe('arj7oStGLkU');
    expect(PLATFORM_INFO.youtube.parseWatchVideoId(DISNEY_URL)).toBeNull();
    expect(PLATFORM_INFO.disney.parseWatchVideoId(DISNEY_URL)).toBe(
      '4b3a1c2e-9f00-4d6b-8a21-0123456789ab',
    );
    expect(PLATFORM_INFO.disney.parseWatchVideoId(NETFLIX_URL)).toBeNull();
  });

  it('lists tab patterns that cover its watch pages', () => {
    expect(PLATFORM_INFO.netflix.tabPatterns).toEqual([
      'https://www.netflix.com/watch/*',
      'https://www.netflix.com/*/watch/*',
    ]);
    expect(PLATFORM_INFO.youtube.tabPatterns).toEqual(
      expect.arrayContaining([
        'https://www.youtube.com/watch*',
        'https://www.youtube.com/shorts/*',
        'https://www.youtube.com/live/*',
      ]),
    );
    expect(PLATFORM_INFO.disney.tabPatterns).toEqual(['https://www.disneyplus.com/*']);
  });

  it('has a host permission in the manifest for every tab pattern (tabs.query by url needs it)', () => {
    const manifest = createManifest('production');
    const granted = manifest.host_permissions ?? [];
    expect(granted).toEqual(
      expect.arrayContaining([
        'https://www.netflix.com/*',
        'https://www.youtube.com/*',
        'https://www.disneyplus.com/*',
      ]),
    );
    for (const info of Object.values(PLATFORM_INFO)) {
      for (const pattern of info.tabPatterns) {
        const origin = /^(https:\/\/[^/]+)\//.exec(pattern)?.[1];
        expect(granted, pattern).toContain(`${origin}/*`);
      }
    }
  });
});

describe('isPlatform', () => {
  it('accepts exactly the three platform ids', () => {
    for (const id of ['netflix', 'youtube', 'disney']) expect(isPlatform(id)).toBe(true);
  });

  it.each([
    ['hulu'],
    ['Netflix'],
    [''],
    ['disney+'],
    ['toString'],
    ['__proto__'],
    ['constructor'],
    [undefined],
    [null],
    [1],
    [{}],
    [['netflix']],
  ])('rejects %j', (value) => {
    expect(isPlatform(value)).toBe(false);
  });
});

describe('detectWatchPage', () => {
  it('names the platform and the id of each watch page', () => {
    expect(detectWatchPage(NETFLIX_URL)).toEqual({ platform: 'netflix', videoId: '83053998' });
    expect(detectWatchPage('https://www.netflix.com/tw/watch/83053998')).toEqual({
      platform: 'netflix',
      videoId: '83053998',
    });
    expect(detectWatchPage(YOUTUBE_URL)).toEqual({ platform: 'youtube', videoId: 'arj7oStGLkU' });
    expect(detectWatchPage(SHORTS_URL)).toEqual({ platform: 'youtube', videoId: 'arj7oStGLkU' });
    expect(detectWatchPage(DISNEY_URL)).toEqual({
      platform: 'disney',
      videoId: '4b3a1c2e-9f00-4d6b-8a21-0123456789ab',
    });
  });

  it('gives null for every other page', () => {
    for (const url of [
      'https://www.netflix.com/browse',
      'https://www.youtube.com/',
      'https://www.youtube.com/results?search_query=cats',
      'https://music.youtube.com/watch?v=arj7oStGLkU',
      'https://www.disneyplus.com/zh-hant/home',
      'https://example.com/watch/83053998',
      'not a url',
      '',
      undefined,
    ]) {
      expect(detectWatchPage(url), String(url)).toBeNull();
    }
  });
});

describe('watchLinkText', () => {
  it('says where a link starts the video when the link keeps the moment (Netflix, YouTube)', () => {
    expect(watchLinkText('netflix', 1_003_469)).toBe('在 Netflix 從 16:43 開始看');
    expect(watchLinkText('youtube', 1_003_469)).toBe('在 YouTube 從 16:43 開始看');
  });

  it('says where the moment is when the link cannot start there (Disney+)', () => {
    expect(watchLinkText('disney', 1_003_469)).toBe('在 Disney+ 打開（這一刻在 16:43）');
  });

  it('writes hours when the moment is past an hour', () => {
    expect(watchLinkText('youtube', 3_723_000)).toBe('在 YouTube 從 1:02:03 開始看');
    expect(watchLinkText('disney', 3_723_000)).toBe('在 Disney+ 打開（這一刻在 1:02:03）');
  });

  it('has a text for every platform', () => {
    for (const platform of Object.keys(PLATFORM_INFO) as Platform[]) {
      expect(watchLinkText(platform, 5000)).toContain(PLATFORM_INFO[platform].label);
    }
  });
});
