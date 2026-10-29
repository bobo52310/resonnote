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
