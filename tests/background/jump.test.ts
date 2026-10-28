import { describe, expect, it, vi } from 'vitest';
import { jumpTo } from '../../src/background/jump';
import type { ToContent } from '../../src/core/messages';

type Deps = Parameters<typeof jumpTo>[1];

const NOTE = { videoId: '83053998', timeMs: 1_003_469 };
const SAME_VIDEO_URL = 'https://www.netflix.com/watch/83053998?trackId=1';
const OTHER_VIDEO_URL = 'https://www.netflix.com/watch/70000001';

function setup(tabs: { id: number; windowId: number; url?: string }[], seekReply: unknown = true) {
  const calls: string[] = [];
  const queryNetflixTabs = vi.fn<Deps['queryNetflixTabs']>(async () => tabs);
  const focus = vi.fn<Deps['focus']>(async () => {
    calls.push('focus');
  });
  const sendToTab = vi.fn<Deps['sendToTab']>(async (_id, _msg: ToContent) => {
    calls.push('seek');
    return seekReply;
  });
  const createTab = vi.fn<Deps['createTab']>(async () => {
    calls.push('create');
  });
  const updateTabUrl = vi.fn<Deps['updateTabUrl']>(async () => {
    calls.push('update');
  });
  const deps: Deps = { queryNetflixTabs, focus, sendToTab, createTab, updateTabUrl };
  return { deps, queryNetflixTabs, focus, sendToTab, createTab, updateTabUrl, calls };
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

  it('opens a new tab at the deep link when no tab has that video', async () => {
    const t = setup([{ id: 1, windowId: 10, url: OTHER_VIDEO_URL }]);
    const result = await jumpTo(NOTE, t.deps);
    expect(result).toBe('new');
    expect(t.createTab).toHaveBeenCalledWith('https://www.netflix.com/watch/83053998?t=1003');
    expect(t.focus).not.toHaveBeenCalled();
    expect(t.sendToTab).not.toHaveBeenCalled();
  });

  it('opens a new tab when there are no Netflix tabs at all', async () => {
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
});
