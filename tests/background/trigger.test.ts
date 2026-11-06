import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToContent } from '../../src/core/messages';
import {
  DEFAULT_ACTION_TITLE,
  RELOAD_BADGE,
  handleTrigger,
  reloadTitle,
} from '../../src/background/trigger';
import config from '../../wxt.config';

const WATCH_URL = 'https://www.netflix.com/watch/83053998?t=600';
const YOUTUBE_URL = 'https://www.youtube.com/watch?v=arj7oStGLkU&t=60s';
const SHORTS_URL = 'https://www.youtube.com/shorts/arj7oStGLkU';
const DISNEY_URL = 'https://www.disneyplus.com/zh-hant/play/4b3a1c2e-9f00-4d6b-8a21-0123456789ab';
const RELOAD_TITLE = '請重新整理這個 Netflix 分頁後再按一次';
const SCREENSHOT = 'data:image/jpeg;base64,U0hPVA==';

type Deps = Parameters<typeof handleTrigger>[1];

function setup(overrides: Partial<Deps> = {}) {
  const calls: string[] = [];
  const sendToTab = vi.fn<Deps['sendToTab']>(async (_tabId, msg: ToContent) => {
    calls.push(msg.type);
    return msg.type === 'resonnote/begin' ? { status: 'ok' } : undefined;
  });
  const captureVisibleTab = vi.fn<Deps['captureVisibleTab']>(async () => {
    calls.push('capture');
    return SCREENSHOT;
  });
  const openNotebook = vi.fn<Deps['openNotebook']>(async () => {});
  const setBadge = vi.fn<Deps['setBadge']>(async () => {});
  const deps: Deps = { sendToTab, captureVisibleTab, openNotebook, setBadge, ...overrides };
  return { deps, sendToTab, captureVisibleTab, openNotebook, setBadge, calls };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('handleTrigger', () => {
  it.each([
    ['a Netflix browse page', 'https://www.netflix.com/browse'],
    ['another site', 'https://example.com'],
    ['an unknown url', undefined],
    ['a lookalike host', 'https://www.netflix.com.evil.test/watch/83053998'],
    ['the YouTube home page', 'https://www.youtube.com/'],
    ['a YouTube search page', 'https://www.youtube.com/results?search_query=cats'],
    ['YouTube Music', 'https://music.youtube.com/watch?v=arj7oStGLkU'],
    ['the Disney+ home page', 'https://www.disneyplus.com/zh-hant/home'],
    ['a Disney+ detail page', 'https://www.disneyplus.com/zh-hant/browse/entity-4b3a1c2e-9f00-4d6b-8a21-0123456789ab'],
  ])('opens notebook for non-watch urls (%s)', async (_label, url) => {
    const t = setup();
    const result = await handleTrigger({ id: 7, windowId: 1, url }, t.deps);
    expect(result).toBe('notebook');
    expect(t.openNotebook).toHaveBeenCalledTimes(1);
    expect(t.sendToTab).not.toHaveBeenCalled();
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('opens the notebook when the tab has no id', async () => {
    const t = setup();
    expect(await handleTrigger({ windowId: 1, url: WATCH_URL }, t.deps)).toBe('notebook');
    expect(t.openNotebook).toHaveBeenCalledTimes(1);
    expect(t.sendToTab).not.toHaveBeenCalled();
  });

  it('trigger skips capture when busy', async () => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce({ status: 'busy' });
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('busy');
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
    expect(t.openNotebook).not.toHaveBeenCalled();
  });

  it('stops when the page has no video', async () => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce({ status: 'no-video' });
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
  });

  it('stops when the content script cannot be reached (page opened before the extension loaded)', async () => {
    const t = setup();
    t.sendToTab.mockRejectedValueOnce(new Error('Could not establish connection.'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], ['ok'], [{ status: 'weird' }]])(
    'stops on an unrecognised begin answer (%j)',
    async (answer) => {
      const t = setup();
      t.sendToTab.mockResolvedValueOnce(answer);
      expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
      expect(t.captureVisibleTab).not.toHaveBeenCalled();
    },
  );

  it('begins first, then captures, then shows the screenshot', async () => {
    const t = setup();
    const result = await handleTrigger({ id: 7, windowId: 3, url: WATCH_URL }, t.deps);
    expect(result).toBe('shown');
    expect(t.calls).toEqual(['resonnote/begin', 'capture', 'resonnote/show']);
    expect(t.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(t.sendToTab).toHaveBeenNthCalledWith(1, 7, { type: 'resonnote/begin' });
    expect(t.sendToTab).toHaveBeenNthCalledWith(2, 7, {
      type: 'resonnote/show',
      dataUrl: SCREENSHOT,
    });
    expect(t.openNotebook).not.toHaveBeenCalled();
  });

  it('still shows the overlay, with dataUrl null, when the screenshot fails', async () => {
    const t = setup();
    t.captureVisibleTab.mockRejectedValueOnce(new Error('Cannot access contents of the page'));
    const result = await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps);
    expect(result).toBe('shown');
    expect(t.sendToTab).toHaveBeenLastCalledWith(7, { type: 'resonnote/show', dataUrl: null });
  });

  it('sends null when the screenshot is not a non-empty string', async () => {
    const t = setup();
    t.captureVisibleTab.mockResolvedValueOnce('');
    await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps);
    expect(t.sendToTab).toHaveBeenLastCalledWith(7, { type: 'resonnote/show', dataUrl: null });
  });

  it('does not throw when the show message cannot be delivered', async () => {
    const t = setup();
    t.sendToTab
      .mockResolvedValueOnce({ status: 'ok' })
      .mockRejectedValueOnce(new Error('The message port closed'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
  });
});

describe.each([
  ['YouTube watch page', YOUTUBE_URL, 'YouTube'],
  ['YouTube Shorts page', SHORTS_URL, 'YouTube'],
  ['Disney+ play page', DISNEY_URL, 'Disney+'],
])('on a %s', (_label, url, platformName) => {
  it('goes through the capture flow, not the notebook', async () => {
    const t = setup();
    const result = await handleTrigger({ id: 7, windowId: 3, url }, t.deps);
    expect(result).toBe('shown');
    expect(t.calls).toEqual(['resonnote/begin', 'capture', 'resonnote/show']);
    expect(t.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(t.openNotebook).not.toHaveBeenCalled();
  });

  it('puts the platform name in the reload hint when the content script cannot be reached', async () => {
    const t = setup();
    t.sendToTab.mockRejectedValueOnce(new Error('Could not establish connection.'));
    expect(await handleTrigger({ id: 7, windowId: 1, url }, t.deps)).toBe('no-video');
    expect(t.setBadge).toHaveBeenCalledTimes(1);
    expect(t.setBadge).toHaveBeenCalledWith(7, '!', `請重新整理這個 ${platformName} 分頁後再按一次`);
  });

  it('puts the platform name in the reload hint when the answer is not a status object', async () => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce(undefined);
    expect(await handleTrigger({ id: 7, windowId: 1, url }, t.deps)).toBe('no-video');
    expect(t.setBadge).toHaveBeenCalledWith(7, '!', `請重新整理這個 ${platformName} 分頁後再按一次`);
  });

  it('clears the badge once the page answers', async () => {
    const t = setup();
    await handleTrigger({ id: 7, windowId: 1, url }, t.deps);
    expect(t.setBadge).toHaveBeenCalledWith(7, '', DEFAULT_ACTION_TITLE);
  });

  it('asks the overlay to explain a refused screenshot from the page button', async () => {
    const t = setup();
    t.captureVisibleTab.mockRejectedValueOnce(new Error('activeTab permission not in effect'));
    await handleTrigger({ id: 7, windowId: 1, url }, t.deps, 'button');
    expect(t.sendToTab).toHaveBeenLastCalledWith(7, {
      type: 'resonnote/show',
      dataUrl: null,
      hint: 'use-shortcut-once',
    });
  });
});

describe('reloadTitle', () => {
  it('names the platform of the tab to reload', () => {
    expect(reloadTitle('Netflix')).toBe('請重新整理這個 Netflix 分頁後再按一次');
    expect(reloadTitle('YouTube')).toBe('請重新整理這個 YouTube 分頁後再按一次');
    expect(reloadTitle('Disney+')).toBe('請重新整理這個 Disney+ 分頁後再按一次');
  });
});

describe('the button on the page', () => {
  const lastShow = (t: ReturnType<typeof setup>) =>
    t.sendToTab.mock.calls.map(([, msg]) => msg).filter((msg) => msg.type === 'resonnote/show').at(-1);

  it('asks the overlay to explain when the screenshot is refused (no shortcut used in the tab yet)', async () => {
    const t = setup();
    t.captureVisibleTab.mockRejectedValueOnce(new Error('activeTab permission not in effect'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps, 'button')).toBe('shown');
    expect(lastShow(t)).toEqual({ type: 'resonnote/show', dataUrl: null, hint: 'use-shortcut-once' });
  });

  it('sends the screenshot without a hint when it works', async () => {
    const t = setup();
    await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps, 'button');
    expect(lastShow(t)).toEqual({ type: 'resonnote/show', dataUrl: SCREENSHOT });
  });

  it('gives no hint for a refused screenshot from the shortcut itself', async () => {
    const t = setup();
    t.captureVisibleTab.mockRejectedValueOnce(new Error('blocked'));
    await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps);
    expect(lastShow(t)).toEqual({ type: 'resonnote/show', dataUrl: null });
  });
});

describe('the reload badge (page opened before the extension was loaded)', () => {
  it('shows ! with an explanation on the tab when the content script cannot be reached', async () => {
    const t = setup();
    t.sendToTab.mockRejectedValueOnce(new Error('Could not establish connection.'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(t.setBadge).toHaveBeenCalledTimes(1);
    expect(t.setBadge).toHaveBeenCalledWith(7, '!', '請重新整理這個 Netflix 分頁後再按一次');
    expect(RELOAD_BADGE).toBe('!');
    expect(reloadTitle('Netflix')).toBe(RELOAD_TITLE);
  });

  it.each([[undefined], [null], ['ok']])('also when the answer is not a status object (%j)', async (answer) => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce(answer);
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(t.setBadge).toHaveBeenCalledWith(7, RELOAD_BADGE, RELOAD_TITLE);
  });

  it('clears the badge and restores the title the next time begin succeeds on that tab', async () => {
    const t = setup();
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('shown');
    expect(t.setBadge).toHaveBeenCalledTimes(1);
    expect(t.setBadge).toHaveBeenCalledWith(7, '', DEFAULT_ACTION_TITLE);
  });

  it.each([['busy'], ['no-video']])('also clears it when the page answers %s (it can be reached)', async (status) => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce({ status });
    await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps);
    expect(t.setBadge).toHaveBeenCalledTimes(1);
    expect(t.setBadge).toHaveBeenCalledWith(7, '', DEFAULT_ACTION_TITLE);
  });

  it('clears the badge without holding up the screenshot', async () => {
    const t = setup();
    t.setBadge.mockImplementation(() => new Promise<void>(() => {})); // never settles
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('shown');
    expect(t.calls).toEqual(['resonnote/begin', 'capture', 'resonnote/show']);
  });

  it('does not touch the badge on pages that open the notebook', async () => {
    const t = setup();
    await handleTrigger({ id: 7, windowId: 1, url: 'https://www.netflix.com/browse' }, t.deps);
    await handleTrigger({ windowId: 1, url: WATCH_URL }, t.deps);
    expect(t.setBadge).not.toHaveBeenCalled();
  });

  it('keeps the outcome when setting or clearing the badge fails', async () => {
    const t = setup();
    t.setBadge.mockRejectedValue(new Error('tab closed'));
    t.sendToTab.mockRejectedValueOnce(new Error('Could not establish connection.'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('shown');
  });

  it('restores the same title as the manifest default', () => {
    const manifest = (config as { manifest?: { action?: { default_title?: string } } }).manifest;
    expect(manifest?.action?.default_title).toBe(DEFAULT_ACTION_TITLE);
  });
});
