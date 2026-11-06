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
  runContentScript({ platform: 'netflix', adapter, watchVideoId: () => 'vid-1', ...overrides });
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
  answers = { 'resonnote/shortcut': '⌥⇧N', 'resonnote/recent': [] };
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
    [{ type: 'resonnote/begin' }],
    [{ type: 'resonnote/show', dataUrl: null }],
    [{ type: 'resonnote/show', dataUrl: 'data:image/jpeg;base64,AA==' }],
    [{ type: 'resonnote/show', dataUrl: null, hint: 'use-shortcut-once' }],
    [{ type: 'resonnote/seek', timeMs: 0 }],
    [{ type: 'resonnote/seek', timeMs: 1003469 }],
    [{ type: 'resonnote/seek', timeMs: 1003469, videoId: 'vid-1' }],
  ])('accepts %j', (message) => {
    expect(isToContent(message)).toBe(true);
  });

  it.each([
    [null],
    ['resonnote/begin'],
    [42],
    [{}],
    [{ type: 'resonnote/save' }],
    [{ type: 'resonnote/show' }],
    [{ type: 'resonnote/show', dataUrl: 5 }],
    [{ type: 'resonnote/show', dataUrl: null, hint: 'something-else' }],
    [{ type: 'resonnote/seek' }],
    [{ type: 'resonnote/seek', timeMs: '600000' }],
    [{ type: 'resonnote/seek', timeMs: Number.NaN }],
    [{ type: 'resonnote/seek', timeMs: Number.POSITIVE_INFINITY }],
    [{ type: 'resonnote/seek', timeMs: 1, videoId: '' }],
    [{ type: 'resonnote/seek', timeMs: 1, videoId: 83053998 }],
    [{ type: 'resonnote/seek', timeMs: 1, videoId: null }],
  ])('rejects %j', (message) => {
    expect(isToContent(message)).toBe(false);
  });
});

describe('runContentScript', () => {
  it('ignores messages that are not for it, so another listener can answer', () => {
    start();
    expect(onMessage({ type: 'resonnote/save' }, {}, () => {})).toBeUndefined();
  });

  it('answers begin with the controller result', async () => {
    start();
    expect(await ask({ type: 'resonnote/begin' })).toEqual({ status: 'ok' });
  });

  it('answers begin with no-video when the page has nothing playing', async () => {
    const adapter = makeAdapter();
    adapter.getPlayback.mockResolvedValue(null);
    start({ adapter });
    expect(await ask({ type: 'resonnote/begin' })).toEqual({ status: 'no-video' });
  });

  it('answers begin with no-video when reading the page fails', async () => {
    const adapter = makeAdapter();
    adapter.getPlayback.mockRejectedValue(new Error('boom'));
    start({ adapter });
    expect(await ask({ type: 'resonnote/begin' })).toEqual({ status: 'no-video' });
  });

  it('answers a second begin with busy while the first capture is open', async () => {
    start();
    await ask({ type: 'resonnote/begin' });
    await ask({ type: 'resonnote/show', dataUrl: null });
    expect(await ask({ type: 'resonnote/begin' })).toEqual({ status: 'busy' });
  });

  describe('seek', () => {
    it('seeks and then pauses so the scene can be looked at', async () => {
      const adapter = start();
      expect(await ask({ type: 'resonnote/seek', timeMs: 600000 })).toBe(true);
      expect(adapter.seek).toHaveBeenCalledWith(600000);
      expect(adapter.pause).toHaveBeenCalledTimes(1);
      expect(adapter.seek.mock.invocationCallOrder[0]!).toBeLessThan(adapter.pause.mock.invocationCallOrder[0]!);
    });

    it('leaves playback alone when the seek failed', async () => {
      const adapter = makeAdapter();
      adapter.seek.mockResolvedValue(false);
      start({ adapter });
      expect(await ask({ type: 'resonnote/seek', timeMs: 600000 })).toBe(false);
      expect(adapter.pause).not.toHaveBeenCalled();
    });

    it('replies with nothing (not an error) when seeking throws', async () => {
      const adapter = makeAdapter();
      adapter.seek.mockRejectedValue(new Error('boom'));
      start({ adapter });
      expect(await ask({ type: 'resonnote/seek', timeMs: 1 })).toBeUndefined();
    });

    it('seeks when the page plays the title the seek is for', async () => {
      const adapter = start({ watchVideoId: () => 'vid-1' });
      expect(await ask({ type: 'resonnote/seek', timeMs: 600000, videoId: 'vid-1' })).toBe(true);
      expect(adapter.seek).toHaveBeenCalledWith(600000);
      expect(adapter.pause).toHaveBeenCalledTimes(1);
    });

    it('declines, without touching the player, when the page plays another title', async () => {
      const adapter = start({ watchVideoId: () => 'vid-2' });
      expect(await ask({ type: 'resonnote/seek', timeMs: 600000, videoId: 'vid-1' })).toBe(false);
      expect(adapter.seek).not.toHaveBeenCalled();
      expect(adapter.pause).not.toHaveBeenCalled();
    });

    it('declines when the page is not a watch page any more', async () => {
      const adapter = start({ watchVideoId: () => null });
      expect(await ask({ type: 'resonnote/seek', timeMs: 600000, videoId: 'vid-1' })).toBe(false);
      expect(adapter.seek).not.toHaveBeenCalled();
      expect(adapter.pause).not.toHaveBeenCalled();
    });

    it('asks which title the page plays at the moment of the seek, not at load', async () => {
      let playing: string | null = 'vid-2';
      const adapter = start({ watchVideoId: () => playing });
      expect(await ask({ type: 'resonnote/seek', timeMs: 1, videoId: 'vid-1' })).toBe(false);
      playing = 'vid-1';
      expect(await ask({ type: 'resonnote/seek', timeMs: 1, videoId: 'vid-1' })).toBe(true);
      expect(adapter.seek).toHaveBeenCalledTimes(1);
    });
  });

  describe('earlier notes', () => {
    it.each(['netflix', 'youtube', 'disney'] as const)('asks the background for the %s notes of this video', async (platform) => {
      start({ platform });
      await ask({ type: 'resonnote/begin' });
      await ask({ type: 'resonnote/show', dataUrl: null });
      expect(sent).toContainEqual({ type: 'resonnote/recent', platform, videoId: 'vid-1', limit: 2 });
    });
  });

  describe('shortcut label', () => {
    const label = () => document.querySelector('[data-resonnote-button]')!.shadowRoot!.querySelector('kbd')!.textContent;

    it('asks the background for the shortcut and shows it on the button', async () => {
      start();
      await vi.waitFor(() => expect(label()).toBe('⌥⇧N'));
      expect(sent).toContainEqual({ type: 'resonnote/shortcut' });
    });

    it('shows no label when the answer is not text', async () => {
      answers['resonnote/shortcut'] = undefined;
      start();
      await vi.waitFor(() => expect(sent).toContainEqual({ type: 'resonnote/shortcut' }));
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
      const host = document.querySelector<HTMLElement>('[data-resonnote-button]')!;
      move();
      expect(host.hasAttribute('data-visible')).toBe(true);
      host.shadowRoot!.querySelector('button')!.click();
      await vi.waitFor(() => expect(sent).toContainEqual({ type: 'resonnote/trigger' }));
    });

    it('stays away when the page is not a watch page', () => {
      start({ watchVideoId: () => null });
      const host = document.querySelector<HTMLElement>('[data-resonnote-button]')!;
      move();
      expect(host.hasAttribute('data-visible')).toBe(false);
    });

    it('sits on the anchor when one is given, and only shows over it', () => {
      const player = document.createElement('div');
      player.getBoundingClientRect = () =>
        ({ left: 0, top: 0, right: 600, bottom: 400, x: 0, y: 0, width: 600, height: 400 }) as DOMRect;
      document.body.append(player);
      start({ quickButtonAnchor: () => player });
      const host = document.querySelector<HTMLElement>('[data-resonnote-button]')!;

      move(900, 300);
      expect(host.hasAttribute('data-visible')).toBe(false);
      move(300, 300);
      expect(host.hasAttribute('data-visible')).toBe(true);
      expect(host.style.right).not.toBe('');
      expect(host.style.bottom).not.toBe('');
    });

    it('floats in the viewport corner without an anchor (no inline position)', () => {
      start();
      const host = document.querySelector<HTMLElement>('[data-resonnote-button]')!;
      move();
      expect(host.style.right).toBe('');
      expect(host.style.bottom).toBe('');
    });
  });

  describe('on-page button during a capture', () => {
    const host = () => document.querySelector<HTMLElement>('[data-resonnote-button]')!;
    const hidden = () => host().style.getPropertyValue('visibility') === 'hidden';
    const move = () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    it('is out of the picture from begin until show, on any platform', async () => {
      // The adapter hides only the player's own controls, as YouTube's does: the button is not among them.
      const adapter = start();
      move();
      expect(host().hasAttribute('data-visible')).toBe(true);

      expect(await ask({ type: 'resonnote/begin' })).toEqual({ status: 'ok' });
      expect(adapter.hidePlayerUi).toHaveBeenCalledTimes(1);
      expect(hidden()).toBe(true);
      expect(host().style.getPropertyPriority('visibility')).toBe('important');
      // A mouse move between the two steps cannot bring it back.
      move();
      expect(hidden()).toBe(true);

      await ask({ type: 'resonnote/show', dataUrl: null });
      expect(hidden()).toBe(false);
    });

    it('comes back together with the player controls', async () => {
      const restorePlayer = vi.fn();
      const adapter = makeAdapter();
      adapter.hidePlayerUi.mockReturnValue(restorePlayer);
      start({ adapter });
      await ask({ type: 'resonnote/begin' });
      expect(restorePlayer).not.toHaveBeenCalled();
      await ask({ type: 'resonnote/show', dataUrl: null });
      expect(restorePlayer).toHaveBeenCalledTimes(1);
      expect(hidden()).toBe(false);
    });

    it('comes back even when the player controls fail to come back', async () => {
      const adapter = makeAdapter();
      adapter.hidePlayerUi.mockReturnValue(() => {
        throw new Error('boom');
      });
      start({ adapter });
      await ask({ type: 'resonnote/begin' });
      expect(hidden()).toBe(true);
      await ask({ type: 'resonnote/show', dataUrl: null });
      expect(hidden()).toBe(false);
    });

    it('does not stay hidden when the player controls cannot be hidden', async () => {
      const adapter = makeAdapter();
      adapter.hidePlayerUi.mockImplementation(() => {
        throw new Error('boom');
      });
      start({ adapter });
      expect(await ask({ type: 'resonnote/begin' })).toEqual({ status: 'ok' });
      expect(hidden()).toBe(false);
    });
  });
});
