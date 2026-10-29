import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isToContent, runContentScript, type ContentScriptOptions } from '../../src/core/content-main';
import type { ToBackground } from '../../src/core/messages';
import type { PlatformAdapter } from '../../src/platforms/types';

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (reply: unknown) => void,
) => unknown;

let onMessage: MessageListener;
let sent: ToBackground[];
/** What the fake background answers to each message type. */
let answers: Partial<Record<ToBackground['type'], unknown>>;

function makeAdapter() {
  return {
    getPlayback: vi.fn<PlatformAdapter['getPlayback']>(async () => ({
      playback: { videoId: 'vid-1', title: '片名', timeMs: 5000 },
      missing: [],
    })),
    getSubtitleText: vi.fn<PlatformAdapter['getSubtitleText']>(() => '台詞'),
    pause: vi.fn<PlatformAdapter['pause']>(async () => true),
    play: vi.fn<PlatformAdapter['play']>(async () => true),
    seek: vi.fn<PlatformAdapter['seek']>(async () => true),
    getVideoRect: vi.fn<PlatformAdapter['getVideoRect']>(() => null),
    hidePlayerUi: vi.fn<PlatformAdapter['hidePlayerUi']>(() => () => {}),
    getTrickplayFrame: vi.fn<PlatformAdapter['getTrickplayFrame']>(async () => null),
    watchUrl: vi.fn<PlatformAdapter['watchUrl']>(() => 'https://example.test'),
  };
}

function start(overrides: Partial<ContentScriptOptions> = {}) {
  const adapter = makeAdapter();
  runContentScript({ platform: 'netflix', adapter, isWatchPage: () => true, ...overrides });
  return adapter;
}

/** What the content script answers to a background message (undefined reply when it declines). */
function ask(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const handled = onMessage(message, {}, resolve);
    if (handled !== true) resolve('ignored');
  });
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '';
  sent = [];
  answers = { 'scenenote/shortcut': '⌥⇧N', 'scenenote/recent': [] };
  vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((listener: MessageListener) => {
    onMessage = listener;
  }) as never);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation((async (message: ToBackground) => {
    sent.push(message);
    return answers[message.type];
  }) as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('isToContent', () => {
  it.each([
    [{ type: 'scenenote/begin' }],
    [{ type: 'scenenote/show', dataUrl: null }],
    [{ type: 'scenenote/show', dataUrl: 'data:image/jpeg;base64,AA==' }],
    [{ type: 'scenenote/show', dataUrl: null, hint: 'use-shortcut-once' }],
    [{ type: 'scenenote/seek', timeMs: 0 }],
    [{ type: 'scenenote/seek', timeMs: 1003469 }],
  ])('accepts %j', (message) => {
    expect(isToContent(message)).toBe(true);
  });

  it.each([
    [null],
    ['scenenote/begin'],
    [42],
    [{}],
    [{ type: 'scenenote/save' }],
    [{ type: 'scenenote/show' }],
    [{ type: 'scenenote/show', dataUrl: 5 }],
    [{ type: 'scenenote/show', dataUrl: null, hint: 'something-else' }],
    [{ type: 'scenenote/seek' }],
    [{ type: 'scenenote/seek', timeMs: '600000' }],
    [{ type: 'scenenote/seek', timeMs: Number.NaN }],
    [{ type: 'scenenote/seek', timeMs: Number.POSITIVE_INFINITY }],
  ])('rejects %j', (message) => {
    expect(isToContent(message)).toBe(false);
  });
});

describe('runContentScript', () => {
  it('ignores messages that are not for it, so another listener can answer', () => {
    start();
    expect(onMessage({ type: 'scenenote/save' }, {}, () => {})).toBeUndefined();
  });

  it('answers begin with the controller result', async () => {
    start();
    expect(await ask({ type: 'scenenote/begin' })).toEqual({ status: 'ok' });
  });

  it('answers begin with no-video when the page has nothing playing', async () => {
    const adapter = makeAdapter();
    adapter.getPlayback.mockResolvedValue(null);
    start({ adapter });
    expect(await ask({ type: 'scenenote/begin' })).toEqual({ status: 'no-video' });
  });

  it('answers begin with no-video when reading the page fails', async () => {
    const adapter = makeAdapter();
    adapter.getPlayback.mockRejectedValue(new Error('boom'));
    start({ adapter });
    expect(await ask({ type: 'scenenote/begin' })).toEqual({ status: 'no-video' });
  });

  it('answers a second begin with busy while the first capture is open', async () => {
    start();
    await ask({ type: 'scenenote/begin' });
    await ask({ type: 'scenenote/show', dataUrl: null });
    expect(await ask({ type: 'scenenote/begin' })).toEqual({ status: 'busy' });
  });

  describe('seek', () => {
    it('seeks and then pauses so the scene can be looked at', async () => {
      const adapter = start();
      expect(await ask({ type: 'scenenote/seek', timeMs: 600000 })).toBe(true);
      expect(adapter.seek).toHaveBeenCalledWith(600000);
      expect(adapter.pause).toHaveBeenCalledTimes(1);
      expect(adapter.seek.mock.invocationCallOrder[0]!).toBeLessThan(adapter.pause.mock.invocationCallOrder[0]!);
    });

    it('leaves playback alone when the seek failed', async () => {
      const adapter = makeAdapter();
      adapter.seek.mockResolvedValue(false);
      start({ adapter });
      expect(await ask({ type: 'scenenote/seek', timeMs: 600000 })).toBe(false);
      expect(adapter.pause).not.toHaveBeenCalled();
    });

    it('replies with nothing (not an error) when seeking throws', async () => {
      const adapter = makeAdapter();
      adapter.seek.mockRejectedValue(new Error('boom'));
      start({ adapter });
      expect(await ask({ type: 'scenenote/seek', timeMs: 1 })).toBeUndefined();
    });
  });

  describe('earlier notes', () => {
    it.each(['netflix', 'youtube', 'disney'] as const)('asks the background for the %s notes of this video', async (platform) => {
      start({ platform });
      await ask({ type: 'scenenote/begin' });
      await ask({ type: 'scenenote/show', dataUrl: null });
      expect(sent).toContainEqual({ type: 'scenenote/recent', platform, videoId: 'vid-1', limit: 2 });
    });
  });

  describe('shortcut label', () => {
    const label = () => document.querySelector('[data-scenenote-button]')!.shadowRoot!.querySelector('kbd')!.textContent;

    it('asks the background for the shortcut and shows it on the button', async () => {
      start();
      await vi.waitFor(() => expect(label()).toBe('⌥⇧N'));
      expect(sent).toContainEqual({ type: 'scenenote/shortcut' });
    });

    it('shows no label when the answer is not text', async () => {
      answers['scenenote/shortcut'] = undefined;
      start();
      await vi.waitFor(() => expect(sent).toContainEqual({ type: 'scenenote/shortcut' }));
      expect(label()).toBe('');
    });

    it('shows no label when the background cannot be reached', async () => {
      vi.mocked(fakeBrowser.runtime.sendMessage).mockRejectedValue(new Error('gone'));
      start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(label()).toBe('');
    });
  });

  describe('on-page button', () => {
    const move = (clientX = 5, clientY = 5) =>
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));

    it('appears while the page is a watch page and asks the background to start a capture', async () => {
      start();
      const host = document.querySelector<HTMLElement>('[data-scenenote-button]')!;
      move();
      expect(host.hasAttribute('data-visible')).toBe(true);
      host.shadowRoot!.querySelector('button')!.click();
      await vi.waitFor(() => expect(sent).toContainEqual({ type: 'scenenote/trigger' }));
    });

    it('stays away when the page is not a watch page', () => {
      start({ isWatchPage: () => false });
      const host = document.querySelector<HTMLElement>('[data-scenenote-button]')!;
      move();
      expect(host.hasAttribute('data-visible')).toBe(false);
    });

    it('sits on the anchor when one is given, and only shows over it', () => {
      const player = document.createElement('div');
      player.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 600, bottom: 400, x: 0, y: 0, width: 600, height: 400 }) as DOMRect;
      document.body.append(player);
      start({ quickButtonAnchor: () => player });
      const host = document.querySelector<HTMLElement>('[data-scenenote-button]')!;

      move(900, 300);
      expect(host.hasAttribute('data-visible')).toBe(false);
      move(300, 300);
      expect(host.hasAttribute('data-visible')).toBe(true);
      expect(host.style.right).not.toBe('');
      expect(host.style.bottom).not.toBe('');
    });

    it('floats in the viewport corner without an anchor (no inline position)', () => {
      start();
      const host = document.querySelector<HTMLElement>('[data-scenenote-button]')!;
      move();
      expect(host.style.right).toBe('');
      expect(host.style.bottom).toBe('');
    });
  });
});
