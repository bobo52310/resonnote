import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { IDLE_HIDE_MS, mountQuickButton, type QuickButtonHandle } from '../../src/core/quick-button';

let handle: QuickButtonHandle | null = null;
let onPress: Mock<() => void>;
let watch = true;
let busy = false;

const host = () => document.querySelector<HTMLElement>('[data-scenenote-button]');
const button = () => host()!.shadowRoot!.querySelector('button')!;
const visible = () => host()?.hasAttribute('data-visible') ?? false;
const moveMouse = () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

beforeEach(() => {
  vi.useFakeTimers();
  watch = true;
  busy = false;
  onPress = vi.fn<() => void>();
  handle = mountQuickButton({ doc: document, onPress, isWatchPage: () => watch, isBusy: () => busy });
});

afterEach(() => {
  handle?.destroy();
  handle = null;
  vi.useRealTimers();
});

describe('quick button', () => {
  it('is on the page but hidden until the mouse moves', () => {
    expect(host()?.parentElement).toBe(document.body);
    expect(visible()).toBe(false);
    moveMouse();
    expect(visible()).toBe(true);
  });

  it('draws its icon as SVG nodes, not an HTML string (YouTube enforces Trusted Types)', () => {
    const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set');
    handle?.destroy();
    handle = mountQuickButton({ doc: document, onPress, isWatchPage: () => watch, isBusy: () => busy });
    expect(setter).not.toHaveBeenCalled();
    setter.mockRestore();
    const svg = button().querySelector('svg');
    expect(svg?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg?.querySelector('rect')).not.toBeNull();
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe('M14 20.5l1-3.5 6-6 2.5 2.5-6 6z');
  });

  it('fades out after the mouse rests, and comes back on the next move', () => {
    moveMouse();
    vi.advanceTimersByTime(IDLE_HIDE_MS - 1);
    expect(visible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible()).toBe(false);
    moveMouse();
    expect(visible()).toBe(true);
  });

  it('stays hidden off watch pages and while the note overlay is open', () => {
    watch = false;
    moveMouse();
    expect(visible()).toBe(false);
    watch = true;
    busy = true;
    moveMouse();
    expect(visible()).toBe(false);
  });

  it('starts a capture on click, hides itself, and keeps the click from the player', () => {
    const playerClick = vi.fn();
    document.addEventListener('click', playerClick);
    try {
      moveMouse();
      button().click();
      expect(onPress).toHaveBeenCalledTimes(1);
      expect(visible()).toBe(false);
      expect(playerClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', playerClick);
    }
  });

  it('says what it does, with the shortcut once known', () => {
    expect(button().textContent).toContain('記下這一刻');
    expect(button().getAttribute('aria-label')).toBe('記下這一刻');
    handle!.setShortcut('⌥⇧N');
    expect(button().querySelector('kbd')?.textContent).toBe('⌥⇧N');
    expect(button().getAttribute('aria-label')).toBe('記下這一刻（⌥⇧N）');
  });

  it('is removed by destroy', () => {
    handle!.destroy();
    handle = null;
    expect(host()).toBeNull();
    moveMouse();
    expect(host()).toBeNull();
  });
});

describe('quick button with an anchor', () => {
  // A 800x450 player 100px from the left and 50px from the top of a 1200x800 window.
  const PLAYER = { left: 100, top: 50, right: 900, bottom: 500 };
  let player: HTMLElement | null;

  const moveMouseTo = (clientX: number, clientY: number) =>
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));

  beforeEach(() => {
    // Replace the default button from the outer beforeEach.
    handle!.destroy();
    (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
      width: 1200,
      height: 800,
    });
    player = document.createElement('div');
    player.getBoundingClientRect = () =>
      ({
        ...PLAYER,
        x: PLAYER.left,
        y: PLAYER.top,
        width: PLAYER.right - PLAYER.left,
        height: PLAYER.bottom - PLAYER.top,
      }) as DOMRect;
    document.body.append(player);
    handle = mountQuickButton({
      doc: document,
      onPress,
      isWatchPage: () => watch,
      isBusy: () => busy,
      anchor: () => player,
    });
  });

  afterEach(() => {
    player?.remove();
    player = null;
  });

  it('shows when the mouse moves inside the anchor and not when it moves outside', () => {
    moveMouseTo(500, 300);
    expect(visible()).toBe(true);
    moveMouseTo(950, 300);
    expect(visible()).toBe(false);
    moveMouseTo(500, 300);
    expect(visible()).toBe(true);
    moveMouseTo(500, 520);
    expect(visible()).toBe(false);
  });

  it('counts the edges of the anchor as inside', () => {
    moveMouseTo(PLAYER.left, PLAYER.top);
    expect(visible()).toBe(true);
    moveMouseTo(PLAYER.right, PLAYER.bottom);
    expect(visible()).toBe(true);
    moveMouseTo(PLAYER.left - 1, PLAYER.top);
    expect(visible()).toBe(false);
    moveMouseTo(PLAYER.right + 1, PLAYER.bottom);
    expect(visible()).toBe(false);
  });

  it('sits 24px from the anchor right edge and 80px above its bottom edge', () => {
    moveMouseTo(500, 300);
    // 1200 - 900 + 24 and 800 - 500 + 80
    expect(host()!.style.right).toBe('324px');
    expect(host()!.style.bottom).toBe('380px');
  });

  it('follows the anchor when it moves or resizes', () => {
    moveMouseTo(500, 300);
    player!.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }) as DOMRect;
    moveMouseTo(500, 300);
    expect(host()!.style.right).toBe('24px');
    expect(host()!.style.bottom).toBe('80px');
  });

  it('hides when the page scrolls, wherever the scrolling happens', () => {
    moveMouseTo(500, 300);
    document.dispatchEvent(new Event('scroll'));
    expect(visible()).toBe(false);

    const inner = document.createElement('div');
    document.body.append(inner);
    moveMouseTo(500, 300);
    expect(visible()).toBe(true);
    inner.dispatchEvent(new Event('scroll'));
    expect(visible()).toBe(false);
    inner.remove();
  });

  it('still fades out after the mouse rests', () => {
    moveMouseTo(500, 300);
    vi.advanceTimersByTime(IDLE_HIDE_MS);
    expect(visible()).toBe(false);
  });

  it('stays hidden off watch pages, while busy, and when the anchor is gone', () => {
    watch = false;
    moveMouseTo(500, 300);
    expect(visible()).toBe(false);
    watch = true;
    busy = true;
    moveMouseTo(500, 300);
    expect(visible()).toBe(false);
    busy = false;
    player!.remove();
    const gone = player;
    player = null;
    handle!.destroy();
    handle = mountQuickButton({
      doc: document,
      onPress,
      isWatchPage: () => true,
      isBusy: () => false,
      anchor: () => null,
    });
    moveMouseTo(500, 300);
    expect(visible()).toBe(false);
    gone?.remove();
  });

  it('goes into the fullscreen element when the player is fullscreen', () => {
    const fullscreen = document.createElement('div');
    document.body.append(fullscreen);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    try {
      moveMouseTo(500, 300);
      expect(host()!.parentElement).toBe(fullscreen);
    } finally {
      delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
      fullscreen.remove();
    }
  });

  it('is removed by destroy, scroll listener included', () => {
    handle!.destroy();
    handle = null;
    expect(host()).toBeNull();
    document.dispatchEvent(new Event('scroll'));
    moveMouseTo(500, 300);
    expect(host()).toBeNull();
  });
});

describe('quick button without an anchor', () => {
  it('is placed by the stylesheet only: no inline position, wherever the mouse is', () => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(visible()).toBe(true);
    expect(host()!.style.right).toBe('');
    expect(host()!.style.bottom).toBe('');
  });

  it('does not hide on scroll', () => {
    moveMouse();
    document.dispatchEvent(new Event('scroll'));
    expect(visible()).toBe(true);
  });
});
