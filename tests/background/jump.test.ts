import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jumpTo, SEEK_RETRY_LIMIT, SEEK_RETRY_MS } from '../../src/background/jump';
import type { ToContent } from '../../src/core/messages';

type Deps = Parameters<typeof jumpTo>[1];

const NOTE = { platform: 'netflix', videoId: '83053998', timeMs: 1_003_469 } as const;
const SAME_VIDEO_URL = 'https://www.netflix.com/watch/83053998?trackId=1';
const OTHER_VIDEO_URL = 'https://www.netflix.com/watch/70000001';

const YOUTUBE_NOTE = { platform: 'youtube', videoId: 'arj7oStGLkU', timeMs: 1_003_469 } as const;
const YOUTUBE_SAME_URL = 'https://www.youtube.com/watch?v=arj7oStGLkU&t=5s';

const DISNEY_ID = '4b3a1c2e-9f00-4d6b-8a21-0123456789ab';
const DISNEY_NOTE = { platform: 'disney', videoId: DISNEY_ID, timeMs: 600_000 } as const;
const DISNEY_SAME_URL = `https://www.disneyplus.com/zh-hant/play/${DISNEY_ID}`;
const DISNEY_LINK = `https://www.disneyplus.com/play/${DISNEY_ID}`;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function setup(
  tabs: { id: number; windowId: number; url?: string }[],
  seekReply: unknown = true,
  /** The id the browser gives the new tab; `null` = it gives none. */
  newTabId: number | null = 99,
) {
  const calls: string[] = [];
  /** Replies for the next seeks, in order; an Error is thrown instead. Afterwards `seekReply` applies. */
  const script: unknown[] = [];
  const queryTabs = vi.fn<Deps['queryTabs']>(async () => tabs);
  const focus = vi.fn<Deps['focus']>(async () => {
    calls.push('focus');
  });
  const sendToTab = vi.fn<Deps['sendToTab']>(async (_id, _msg: ToContent) => {
    calls.push('seek');
    if (script.length === 0) return seekReply;
    const next = script.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const createTab = vi.fn<Deps['createTab']>(async () => {
    calls.push('create');
    return newTabId ?? undefined;
  });
  const updateTabUrl = vi.fn<Deps['updateTabUrl']>(async () => {
    calls.push('update');
  });
  const wait = vi.fn<Deps['wait']>(async () => {
    calls.push('wait');
  });
  const deps: Deps = { queryTabs, focus, sendToTab, createTab, updateTabUrl, wait };
  return { deps, queryTabs, focus, sendToTab, createTab, updateTabUrl, wait, calls, script };
}

describe('jumpTo', () => {
  it('focuses the tab already playing the same video and seeks it', async () => {
    const t = setup([
      { id: 1, windowId: 10, url: OTHER_VIDEO_URL },
      { id: 2, windowId: 20, url: SAME_VIDEO_URL },
    ]);
    const result = await jumpTo(NOTE, t.deps);
    expect(result).toBe('existing');
    expect(t.focus).toHaveBeenCalledWith(2, 20);
    expect(t.sendToTab).toHaveBeenCalledWith(2, { type: 'scenenote/seek', timeMs: 1_003_469 });
    expect(t.calls).toEqual(['focus', 'seek']);
    expect(t.createTab).not.toHaveBeenCalled();
    expect(t.updateTabUrl).not.toHaveBeenCalled();
  });

  it("looks for tabs with the platform's own match patterns", async () => {
    const t = setup([]);
    await jumpTo(NOTE, t.deps);
    expect(t.queryTabs).toHaveBeenCalledWith([
      'https://www.netflix.com/watch/*',
      'https://www.netflix.com/*/watch/*',
    ]);
  });

  it('opens a new tab at the deep link when no tab has that video', async () => {
    const t = setup([{ id: 1, windowId: 10, url: OTHER_VIDEO_URL }]);
    const result = await jumpTo(NOTE, t.deps);
    expect(result).toBe('new');
    expect(t.createTab).toHaveBeenCalledWith('https://www.netflix.com/watch/83053998?t=1003');
    expect(t.focus).not.toHaveBeenCalled();
    expect(t.sendToTab).not.toHaveBeenCalled();
  });

  it('opens a new tab when there are no tabs of the platform at all', async () => {
    const t = setup([]);
    expect(await jumpTo(NOTE, t.deps)).toBe('new');
    expect(t.createTab).toHaveBeenCalledTimes(1);
  });

  it('ignores tabs without a url and tabs on non-watch pages', async () => {
    const t = setup([
      { id: 1, windowId: 10 },
      { id: 2, windowId: 10, url: 'https://www.netflix.com/browse' },
    ]);
    expect(await jumpTo(NOTE, t.deps)).toBe('new');
  });

  it('does not mistake a video id that merely starts with the same digits', async () => {
    const t = setup([{ id: 1, windowId: 10, url: 'https://www.netflix.com/watch/830539981' }]);
    expect(await jumpTo(NOTE, t.deps)).toBe('new');
  });

  it('falls back to navigating the existing tab when the seek reply is false', async () => {
    const t = setup([{ id: 2, windowId: 20, url: SAME_VIDEO_URL }], false);
    const result = await jumpTo(NOTE, t.deps);
    expect(result).toBe('existing');
    expect(t.focus).toHaveBeenCalledWith(2, 20);
    expect(t.updateTabUrl).toHaveBeenCalledWith(2, 'https://www.netflix.com/watch/83053998?t=1003');
    expect(t.createTab).not.toHaveBeenCalled();
  });

  it('falls back to navigating the existing tab when the seek message throws', async () => {
    const t = setup([{ id: 2, windowId: 20, url: SAME_VIDEO_URL }]);
    t.sendToTab.mockRejectedValueOnce(new Error('Could not establish connection'));
    const result = await jumpTo(NOTE, t.deps);
    expect(result).toBe('existing');
    expect(t.updateTabUrl).toHaveBeenCalledWith(2, 'https://www.netflix.com/watch/83053998?t=1003');
    expect(t.createTab).not.toHaveBeenCalled();
  });

  it('falls back when the content script gives no reply at all', async () => {
    const t = setup([{ id: 2, windowId: 20, url: SAME_VIDEO_URL }]);
    t.sendToTab.mockResolvedValueOnce(undefined);
    expect(await jumpTo(NOTE, t.deps)).toBe('existing');
    expect(t.updateTabUrl).toHaveBeenCalledTimes(1);
  });

  it('does not take a tab of another platform that happens to show the same id string', async () => {
    // An 11-digit Netflix title id is also a well-formed YouTube video id.
    const note = { platform: 'youtube', videoId: '12345678901', timeMs: 5000 } as const;
    const t = setup([{ id: 1, windowId: 10, url: 'https://www.netflix.com/watch/12345678901' }]);
    expect(await jumpTo(note, t.deps)).toBe('new');
    expect(t.focus).not.toHaveBeenCalled();
    expect(t.createTab).toHaveBeenCalledWith('https://www.youtube.com/watch?v=12345678901&t=5s');

    const netflixNote = { platform: 'netflix', videoId: '12345678901', timeMs: 5000 } as const;
    const t2 = setup([{ id: 1, windowId: 10, url: 'https://www.youtube.com/watch?v=12345678901' }]);
    expect(await jumpTo(netflixNote, t2.deps)).toBe('new');
    expect(t2.focus).not.toHaveBeenCalled();
  });
});

describe('jumpTo on YouTube', () => {
  it('focuses and seeks the tab that already plays the video', async () => {
    const t = setup([
      { id: 1, windowId: 10, url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz' },
      { id: 2, windowId: 20, url: YOUTUBE_SAME_URL },
    ]);
    expect(await jumpTo(YOUTUBE_NOTE, t.deps)).toBe('existing');
    expect(t.queryTabs).toHaveBeenCalledWith(
      expect.arrayContaining([
        'https://www.youtube.com/watch*',
        'https://www.youtube.com/shorts/*',
        'https://www.youtube.com/live/*',
      ]),
    );
    expect(t.focus).toHaveBeenCalledWith(2, 20);
    expect(t.sendToTab).toHaveBeenCalledWith(2, { type: 'scenenote/seek', timeMs: 1_003_469 });
  });

  it('finds the video on a Shorts page too', async () => {
    const t = setup([{ id: 3, windowId: 10, url: 'https://www.youtube.com/shorts/arj7oStGLkU' }]);
    expect(await jumpTo(YOUTUBE_NOTE, t.deps)).toBe('existing');
    expect(t.focus).toHaveBeenCalledWith(3, 10);
  });

  it('opens the link with the time in it, and does not retry the seek', async () => {
    const t = setup([]);
    expect(await jumpTo(YOUTUBE_NOTE, t.deps)).toBe('new');
    expect(t.createTab).toHaveBeenCalledWith('https://www.youtube.com/watch?v=arj7oStGLkU&t=1003s');
    expect(t.wait).not.toHaveBeenCalled();
    expect(t.sendToTab).not.toHaveBeenCalled();
  });

  it('navigates a tab that cannot be sought to the link and does not retry the seek', async () => {
    const t = setup([{ id: 2, windowId: 20, url: YOUTUBE_SAME_URL }], false);
    expect(await jumpTo(YOUTUBE_NOTE, t.deps)).toBe('existing');
    expect(t.updateTabUrl).toHaveBeenCalledWith(
      2,
      'https://www.youtube.com/watch?v=arj7oStGLkU&t=1003s',
    );
    expect(t.wait).not.toHaveBeenCalled();
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
  });
});

describe('jumpTo on Disney+ (the link cannot carry the time)', () => {
  it('seeks the tab that already plays the title without opening anything', async () => {
    const t = setup([{ id: 4, windowId: 40, url: DISNEY_SAME_URL }]);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('existing');
    expect(t.queryTabs).toHaveBeenCalledWith(['https://www.disneyplus.com/*']);
    expect(t.focus).toHaveBeenCalledWith(4, 40);
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
    expect(t.sendToTab).toHaveBeenCalledWith(4, { type: 'scenenote/seek', timeMs: 600_000 });
    expect(t.wait).not.toHaveBeenCalled();
    expect(t.createTab).not.toHaveBeenCalled();
    expect(t.updateTabUrl).not.toHaveBeenCalled();
  });

  it('only takes a Disney+ tab that plays this very title', async () => {
    const t = setup([
      { id: 1, windowId: 10, url: 'https://www.disneyplus.com/zh-hant/home' },
      {
        id: 2,
        windowId: 10,
        url: 'https://www.disneyplus.com/zh-hant/play/11111111-2222-4333-8444-555555555555',
      },
    ]);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('new');
    expect(t.focus).not.toHaveBeenCalled();
  });

  it('matches a tab whose url has the id in capitals', async () => {
    const upper = `https://www.disneyplus.com/zh-hant/play/${DISNEY_ID.toUpperCase()}`;
    const t = setup([{ id: 4, windowId: 40, url: upper }]);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('existing');
  });

  it('opens the link in a new tab, then asks every second until the seek works', async () => {
    const t = setup([]);
    t.script.push(new Error('Could not establish connection. Receiving end does not exist.'), false, true);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('new');
    expect(t.createTab).toHaveBeenCalledWith(DISNEY_LINK);
    expect(t.sendToTab).toHaveBeenCalledTimes(3);
    for (const call of t.sendToTab.mock.calls) {
      expect(call).toEqual([99, { type: 'scenenote/seek', timeMs: 600_000 }]);
    }
    expect(t.wait).toHaveBeenCalledTimes(3);
    for (const call of t.wait.mock.calls) expect(call).toEqual([SEEK_RETRY_MS]);
    expect(SEEK_RETRY_MS).toBe(1000);
    // The page needs time to load, so the first ask comes after a wait, not right away.
    expect(t.calls).toEqual(['create', 'wait', 'seek', 'wait', 'seek', 'wait', 'seek']);
  });

  it('stops asking after the first success', async () => {
    const t = setup([], true);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('new');
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
    expect(t.wait).toHaveBeenCalledTimes(1);
  });

  it('gives up after 30 failed attempts, only warns, and still reports a new tab', async () => {
    const t = setup([], false);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('new');
    expect(SEEK_RETRY_LIMIT).toBe(30);
    expect(t.sendToTab).toHaveBeenCalledTimes(30);
    expect(t.wait).toHaveBeenCalledTimes(30);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toMatch(/^\[scenenote\]/);
  });

  it('counts a message that throws as a failed attempt too, for all 30', async () => {
    const t = setup([]);
    t.sendToTab.mockRejectedValue(new Error('Could not establish connection'));
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('new');
    expect(t.sendToTab).toHaveBeenCalledTimes(30);
    expect(t.wait).toHaveBeenCalledTimes(30);
  });

  it('does not ask a tab it cannot name when the browser gives no id for the new tab', async () => {
    const t = setup([], true, null);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('new');
    expect(t.createTab).toHaveBeenCalledWith(DISNEY_LINK);
    expect(t.sendToTab).not.toHaveBeenCalled();
    expect(t.wait).not.toHaveBeenCalled();
  });

  it('retries on the same tab after navigating it, when the first seek did not work', async () => {
    const t = setup([{ id: 4, windowId: 40, url: DISNEY_SAME_URL }]);
    t.script.push(
      false, // the tab, before it is navigated
      new Error('Could not establish connection'), // the page is reloading
      true,
    );
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('existing');
    expect(t.updateTabUrl).toHaveBeenCalledWith(4, DISNEY_LINK);
    expect(t.createTab).not.toHaveBeenCalled();
    expect(t.sendToTab).toHaveBeenCalledTimes(3);
    expect(t.sendToTab).toHaveBeenLastCalledWith(4, { type: 'scenenote/seek', timeMs: 600_000 });
    expect(t.calls).toEqual(['focus', 'seek', 'update', 'wait', 'seek', 'wait', 'seek']);
  });

  it('gives up on a navigated tab after 30 failed attempts and still reports the existing tab', async () => {
    const t = setup([{ id: 4, windowId: 40, url: DISNEY_SAME_URL }], false);
    expect(await jumpTo(DISNEY_NOTE, t.deps)).toBe('existing');
    // One seek before the navigation, then 30 on the navigated tab.
    expect(t.sendToTab).toHaveBeenCalledTimes(31);
    expect(t.wait).toHaveBeenCalledTimes(30);
    expect(t.updateTabUrl).toHaveBeenCalledTimes(1);
  });
});
