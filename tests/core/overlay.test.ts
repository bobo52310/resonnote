import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  MISSING_LABELS,
  openOverlay,
  type OverlayHandle,
  type OverlayResult,
} from '../../src/core/overlay/overlay';
import type { Missing } from '../../src/core/types';

let mount: HTMLElement;
let handle: OverlayHandle | null = null;
let onOpenNotebook: Mock<() => void>;

function open(overrides: Partial<Parameters<typeof openOverlay>[0]> = {}): OverlayHandle {
  handle = openOverlay({
    mount,
    thumbUrl: 'blob:thumb-1',
    heading: '黑暗榮耀 S1:E3',
    time: '16:43',
    subtitle: '你好嗎',
    missing: [],
    onOpenNotebook,
    ...overrides,
  });
  return handle;
}

function shadow(): ShadowRoot {
  const host = mount.querySelector('[data-scenenote-overlay]');
  if (!host?.shadowRoot) throw new Error('overlay host / shadow root not found');
  return host.shadowRoot;
}

function el<T extends HTMLElement>(selector: string): T {
  const found = shadow().querySelector<T>(selector);
  if (!found) throw new Error(`not found: ${selector}`);
  return found;
}

const note = () => el<HTMLTextAreaElement>('[data-role="note"]');
const subtitle = () => el<HTMLTextAreaElement>('[data-role="subtitle"]');

function press(
  target: Element,
  init: KeyboardEventInit & { keyCode?: number },
): KeyboardEvent {
  const { keyCode, ...rest } = init;
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...rest,
  });
  if (keyCode !== undefined) Object.defineProperty(ev, 'keyCode', { value: keyCode });
  target.dispatchEvent(ev);
  return ev;
}

async function isPending(p: Promise<OverlayResult>): Promise<boolean> {
  const sentinel = Symbol('pending');
  return (await Promise.race([p, Promise.resolve(sentinel)])) === sentinel;
}

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  onOpenNotebook = vi.fn<() => void>();
});

afterEach(() => {
  handle?.close();
  handle = null;
  mount.remove();
});

describe('MISSING_LABELS', () => {
  it('has the exact zh-TW strings for every Missing key', () => {
    expect(MISSING_LABELS).toEqual({
      fullFrame: '完整畫面截不到，改用進度條小圖',
      image: '沒有截到圖',
      subtitle: '沒抓到台詞',
      title: '沒抓到片名',
      playerApi: 'Netflix 播放器介面讀不到，秒數改從影片讀',
      useShortcutOnce:
        '畫面上的按鈕截不到完整畫面：請先在這個分頁按一次快捷鍵或工具列的 scenenote 圖示，之後按鈕就能截完整畫面',
    });
  });
});

describe('rendering', () => {
  it('mounts a host with a shadow root into the given mount element', () => {
    open();
    const host = mount.querySelector('[data-scenenote-overlay]');
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(mount);
    expect(host?.shadowRoot).not.toBeNull();
    expect(handle?.isOpen()).toBe(true);
  });

  it('shows the heading, the time and an editable subtitle', () => {
    open();
    expect(el('[data-role="heading"]').textContent).toBe('黑暗榮耀 S1:E3');
    expect(el('[data-role="time"]').textContent).toBe('16:43');
    expect(subtitle().value).toBe('你好嗎');
    subtitle().value = '改過的台詞';
    expect(subtitle().value).toBe('改過的台詞');
  });

  it('shows the thumbnail on the left when thumbUrl is given', () => {
    open({ thumbUrl: 'blob:thumb-1' });
    expect(el<HTMLImageElement>('img[data-role="thumb"]').getAttribute('src')).toBe('blob:thumb-1');
  });

  it('omits the img element when thumbUrl is null', () => {
    open({ thumbUrl: null });
    expect(shadow().querySelector('img')).toBeNull();
  });

  it('lists a Chinese label for every missing item', () => {
    const missing: Missing[] = ['subtitle', 'fullFrame', 'playerApi'];
    open({ missing });
    const text = shadow().querySelector('[data-role="missing"]')?.textContent ?? '';
    for (const m of missing) expect(text).toContain(MISSING_LABELS[m]);
    expect(text).not.toContain(MISSING_LABELS.title);
    expect(shadow().querySelectorAll('[data-role="missing"] li')).toHaveLength(3);
  });

  it('renders no missing section when nothing is missing', () => {
    open({ missing: [] });
    expect(shadow().querySelector('[data-role="missing"]')).toBeNull();
  });

  it('treats heading text as text, never as HTML', () => {
    open({ heading: '<b id="x">片名</b>', subtitle: '<i>台詞</i>' });
    expect(shadow().querySelector('#x')).toBeNull();
    expect(el('[data-role="heading"]').textContent).toBe('<b id="x">片名</b>');
    expect(subtitle().value).toBe('<i>台詞</i>');
  });

  it('injects its own style element into the shadow root', () => {
    open();
    expect(shadow().querySelector('style')?.textContent?.length).toBeGreaterThan(0);
  });

  it('focuses the note textarea when it opens', () => {
    open();
    expect(shadow().activeElement).toBe(note());
  });
});

describe('save and cancel', () => {
  it('saves on Enter in the note box with the edited subtitle and body', async () => {
    const h = open();
    subtitle().value = '改過的台詞';
    note().value = '這一幕的光影很讚';
    const ev = press(note(), { key: 'Enter' });
    expect(ev.defaultPrevented).toBe(true);
    await expect(h.result).resolves.toEqual({
      action: 'save',
      subtitle: '改過的台詞',
      body: '這一幕的光影很讚',
    });
  });

  it('can save with an empty note', async () => {
    const h = open();
    press(note(), { key: 'Enter' });
    await expect(h.result).resolves.toEqual({ action: 'save', subtitle: '你好嗎', body: '' });
  });

  it('does not save on Enter while composing (isComposing)', async () => {
    const h = open();
    note().value = '選字中';
    const ev = press(note(), { key: 'Enter', isComposing: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(await isPending(h.result)).toBe(true);
  });

  it('does not save on Enter with keyCode 229 even if isComposing is false', async () => {
    const h = open();
    press(note(), { key: 'Enter', isComposing: false, keyCode: 229 });
    expect(await isPending(h.result)).toBe(true);
  });

  it('does not save on Shift+Enter and leaves the newline to the textarea', async () => {
    const h = open();
    const ev = press(note(), { key: 'Enter', shiftKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(await isPending(h.result)).toBe(true);
  });

  it('cancels on Esc in the note box', async () => {
    const h = open();
    note().value = '不要了';
    press(note(), { key: 'Escape' });
    await expect(h.result).resolves.toEqual({ action: 'cancel' });
  });

  it('cancels on Esc from the subtitle field too', async () => {
    const h = open();
    press(subtitle(), { key: 'Escape' });
    await expect(h.result).resolves.toEqual({ action: 'cancel' });
  });

  it('does not cancel on Esc while an IME composition is active', async () => {
    const h = open();
    press(note(), { key: 'Escape', isComposing: true });
    press(note(), { key: 'Escape', keyCode: 229 });
    expect(await isPending(h.result)).toBe(true);
  });

  it('moves focus to the note box on Enter in the subtitle field instead of saving', async () => {
    const h = open();
    subtitle().focus();
    const ev = press(subtitle(), { key: 'Enter' });
    expect(ev.defaultPrevented).toBe(true);
    expect(shadow().activeElement).toBe(note());
    expect(await isPending(h.result)).toBe(true);
  });

  it('resolves result only once: later Enter/Esc are ignored until reopenResult', async () => {
    const h = open();
    note().value = '第一次';
    press(note(), { key: 'Enter' });
    note().value = '第二次';
    press(note(), { key: 'Enter' });
    press(note(), { key: 'Escape' });
    await expect(h.result).resolves.toEqual({ action: 'save', subtitle: '你好嗎', body: '第一次' });
    expect(await isPending(h.reopenResult())).toBe(true);
  });

  it('does not close the overlay by itself after save or cancel', async () => {
    const h = open();
    press(note(), { key: 'Enter' });
    await h.result;
    expect(h.isOpen()).toBe(true);
    expect(mount.querySelector('[data-scenenote-overlay]')).not.toBeNull();
  });
});

describe('keyboard isolation', () => {
  it('does not let keydown bubble to document listeners', () => {
    open();
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    try {
      for (const target of [note(), subtitle()]) {
        for (const key of [' ', 'f', 'm', 'ArrowLeft', 'Enter', 'Escape']) {
          press(target, { key });
        }
      }
      expect(onDocKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onDocKey);
    }
  });

  it('also keeps keyup and keypress away from the page', () => {
    open();
    const onDocKey = vi.fn();
    document.addEventListener('keyup', onDocKey);
    document.addEventListener('keypress', onDocKey);
    try {
      for (const type of ['keyup', 'keypress']) {
        note().dispatchEvent(new KeyboardEvent(type, { key: ' ', bubbles: true, composed: true }));
      }
      expect(onDocKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keyup', onDocKey);
      document.removeEventListener('keypress', onDocKey);
    }
  });

  it('control: a composed event from inside the shadow DOM does reach document', () => {
    open();
    const onDoc = vi.fn();
    document.addEventListener('probe', onDoc);
    try {
      note().dispatchEvent(new Event('probe', { bubbles: true, composed: true }));
      expect(onDoc).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('probe', onDoc);
    }
  });

  it('does not let clicks inside or around the panel reach document listeners', () => {
    open();
    const onDocClick = vi.fn();
    document.addEventListener('click', onDocClick);
    try {
      note().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      const host = mount.querySelector('[data-scenenote-overlay]')!;
      host.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      expect(onDocClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', onDocClick);
    }
  });
});

describe('mousedown focus handling (shadow DOM retargeting)', () => {
  const host = () => mount.querySelector('[data-scenenote-overlay]') as HTMLElement;

  /**
   * Dispatches a mousedown from `origin` the way a real browser presents it to
   * a listener on the shadow host: `event.target` is retargeted to the host
   * while `composedPath()[0]` stays the real origin. happy-dom does not
   * retarget, so the host's view is simulated by overriding `target`.
   */
  function mousedownFrom(origin: Element, { retarget }: { retarget: boolean }): MouseEvent {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    if (retarget) Object.defineProperty(ev, 'target', { get: () => host() });
    origin.dispatchEvent(ev);
    return ev;
  }

  it('simulation check: a host listener sees target === host but the real origin in composedPath', () => {
    open();
    const seen: { target: EventTarget | null; origin: EventTarget | undefined }[] = [];
    host().addEventListener('mousedown', (e) =>
      seen.push({ target: e.target, origin: e.composedPath()[0] }),
    );
    mousedownFrom(note(), { retarget: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.target).toBe(host());
    expect(seen[0]?.origin).toBe(note());
  });

  it.each([
    ['the note textarea', () => note()],
    ['the subtitle field', () => subtitle()],
    ['the notebook link', () => el('[data-role="open-notebook"]')],
  ])('does not prevent default for a mousedown on %s (retargeted to the host)', (_name, getOrigin) => {
    open();
    const ev = mousedownFrom(getOrigin(), { retarget: true });
    expect(ev.defaultPrevented).toBe(false);
  });

  it('prevents default for a mousedown on the dimmed backdrop (the host itself)', () => {
    open();
    const ev = mousedownFrom(host(), { retarget: false });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('still keeps the mousedown from reaching document listeners', () => {
    open();
    const onDocMouseDown = vi.fn();
    document.addEventListener('mousedown', onDocMouseDown);
    try {
      mousedownFrom(note(), { retarget: true });
      mousedownFrom(host(), { retarget: false });
      expect(onDocMouseDown).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('mousedown', onDocMouseDown);
    }
  });
});

describe('focus stays inside the overlay after clicking its non-input parts', () => {
  /** The element a key press would go to: the deepest active element, through shadow roots. */
  function keyTarget(): Element {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active ?? document.body;
  }

  /**
   * What a browser does for a left click: fire mousedown and, unless it was prevented, focus the
   * nearest focusable ancestor of the clicked element; with none, focus goes to <body>.
   * (happy-dom dispatches events but does not move focus by itself.)
   */
  function clickLikeABrowser(origin: Element): void {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true });
    origin.dispatchEvent(down);
    if (down.defaultPrevented) return;
    let node: Element | null = origin;
    while (node) {
      const focusable =
        node.hasAttribute('tabindex') || node.tagName === 'TEXTAREA' || node.tagName === 'BUTTON';
      if (focusable) {
        (node as HTMLElement).focus();
        return;
      }
      node = node.parentElement;
    }
    (keyTarget() as HTMLElement).blur();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  it('makes the panel focusable by script and by mouse, but not by Tab', () => {
    open();
    const panel = el('.panel');
    expect(panel.getAttribute('tabindex')).toBe('-1');
    expect(shadow().querySelector('style')?.textContent).toMatch(/\.panel:focus\s*{[^}]*outline:\s*none/);
  });

  it.each([
    ['the heading', '[data-role="heading"]'],
    ['the time', '[data-role="time"]'],
    ['the thumbnail', '[data-role="thumb"]'],
    ['the key hints', '.hint'],
    ['the list of missing things', '[data-role="missing"] li'],
  ])('does not hand Space and F to the page after a click on %s', (_name, selector) => {
    open({ missing: ['subtitle'] });
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    try {
      clickLikeABrowser(el(selector));
      // focus did not fall out to <body> / the page
      expect(keyTarget()).not.toBe(document.body);
      for (const key of [' ', 'f']) press(keyTarget(), { key });
      expect(onDocKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onDocKey);
    }
  });

  it('still cancels on Esc when the panel itself has the focus', async () => {
    const h = open();
    clickLikeABrowser(el('[data-role="heading"]'));
    press(keyTarget(), { key: 'Escape' });
    await expect(h.result).resolves.toEqual({ action: 'cancel' });
  });

  it('does not save on Enter pressed on the panel itself (only the note box saves)', async () => {
    const h = open();
    clickLikeABrowser(el('[data-role="heading"]'));
    press(keyTarget(), { key: 'Enter' });
    expect(await isPending(h.result)).toBe(true);
  });
});

describe('focus and keys taken by the page', () => {
  it('takes focus back to the note box when the page focuses one of its own elements', () => {
    open();
    const player = document.createElement('div');
    player.tabIndex = 0;
    document.body.append(player);
    player.focus();
    expect(shadow().activeElement).toBe(note());
  });

  it('takes focus back to the box the user was typing in', () => {
    open();
    subtitle().focus();
    const player = document.createElement('button');
    document.body.append(player);
    player.focus();
    expect(shadow().activeElement).toBe(subtitle());
  });

  it('takes focus back after a plain blur that leaves focus on the page body', async () => {
    open();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    note().blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadow().activeElement).toBe(note());
  });

  it('keeps keys that land outside the overlay away from the page while it is open', () => {
    open();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    try {
      press(document.body, { key: ' ' });
      expect(pageKeys).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', pageKeys);
    }
  });

  it('lets the page have its focus and keys back once closed', () => {
    const h = open();
    h.close();
    const pageKeys = vi.fn();
    document.addEventListener('keydown', pageKeys);
    const player = document.createElement('button');
    document.body.append(player);
    try {
      player.focus();
      expect(document.activeElement).toBe(player);
      press(document.body, { key: ' ' });
      expect(pageKeys).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', pageKeys);
    }
  });

  it('still saves on Enter in the note box (its own keys are not blocked)', async () => {
    const h = open();
    note().value = '心得';
    press(note(), { key: 'Enter' });
    expect(await h.result).toEqual({ action: 'save', subtitle: '你好嗎', body: '心得' });
  });
});

describe('film strip of earlier notes', () => {
  const earlier = (id: string, timeMs: number, body = '', thumb: string | null = 'data:image/jpeg;base64,QQ==') => ({
    id,
    timeMs,
    subtitle: '台詞',
    body,
    thumb,
  });
  const frames = () => Array.from(shadow().querySelectorAll<HTMLElement>('.frame'));
  const times = () => frames().map((f) => f.querySelector('.frame-time')?.textContent);

  it('runs oldest to newest, then this moment, with at most two earlier notes', () => {
    const h = open();
    h.showPrevious([earlier('a', 925_000, '伏筆'), earlier('b', 725_000), earlier('c', 60_000)]);
    expect(times()).toEqual(['12:05', '15:25', '16:43']);
    expect(frames().map((f) => f.dataset['age'] ?? 'now')).toEqual(['2', '1', 'now']);
    expect(frames()[2]!.classList.contains('now')).toBe(true);
    expect(frames()[2]!.querySelector('img')?.getAttribute('src')).toBe('blob:thumb-1');
    expect(shadow().querySelectorAll('[data-role="previous"]')).toHaveLength(2);
  });

  it('sits at the top of the panel', () => {
    const h = open();
    h.showPrevious([earlier('a', 1000)]);
    expect(el('.panel').firstElementChild?.classList.contains('film')).toBe(true);
  });

  it('captions the latest earlier note, and the hovered frame on mouseenter', () => {
    const h = open();
    h.showPrevious([earlier('a', 925_000, '伏筆'), earlier('b', 725_000)]);
    const caption = el('.film-caption');
    expect(caption.textContent).toBe('15:25伏筆');
    frames()[0]!.dispatchEvent(new MouseEvent('mouseenter'));
    // no thoughts: the subtitle stands in
    expect(caption.textContent).toBe('12:05台詞');
    el('.frames').dispatchEvent(new MouseEvent('mouseleave'));
    expect(caption.textContent).toBe('15:25伏筆');
  });

  it('draws an empty frame for an earlier note without a picture', () => {
    const h = open();
    h.showPrevious([earlier('a', 1000, '', null)]);
    expect(frames()[0]!.querySelector('img')).toBeNull();
  });

  it('does nothing without a picture of its own, with no earlier notes, or once closed', () => {
    const h = open({ thumbUrl: null });
    h.showPrevious([earlier('a', 1000)]);
    expect(shadow().querySelector('.film')).toBeNull();
    h.close();
    const h2 = open();
    h2.showPrevious([]);
    expect(shadow().querySelector('.film')).toBeNull();
    h2.close();
    h2.showPrevious([earlier('a', 1000)]);
    expect(mount.querySelectorAll('[data-scenenote-overlay]')).toHaveLength(0);
  });

  it('replaces the strip when called again', () => {
    const h = open();
    h.showPrevious([earlier('a', 1000), earlier('b', 2000)]);
    h.showPrevious([earlier('c', 3000)]);
    expect(shadow().querySelectorAll('.film')).toHaveLength(1);
    expect(frames()).toHaveLength(2);
  });
});

describe('switching to an earlier note from the film strip', () => {
  const earlier = (id: string, timeMs: number, body: string, thumb: string | null = `data:image/jpeg;base64,${id}`) => ({
    id,
    timeMs,
    subtitle: `台詞${id}`,
    body,
    thumb,
  });
  const frameAt = (time: string) =>
    Array.from(shadow().querySelectorAll<HTMLElement>('.frame')).find(
      (f) => f.querySelector('.frame-time')?.textContent === time,
    )!;
  const mainThumb = () => el<HTMLImageElement>('[data-role="thumb"]');

  function setup() {
    const onEditPrevious = vi.fn();
    const h = open({ onEditPrevious });
    h.showPrevious([earlier('b', 925_000, '伏筆'), earlier('a', 725_000, '')]);
    return { h, onEditPrevious };
  }

  it('puts the clicked note in the panel and marks its frame', () => {
    setup();
    note().value = '這一刻打到一半';
    frameAt('15:25').click();
    expect(el('[data-role="time"]').textContent).toBe('15:25');
    expect(subtitle().value).toBe('台詞b');
    expect(note().value).toBe('伏筆');
    expect(mainThumb().getAttribute('src')).toBe('data:image/jpeg;base64,b');
    expect(frameAt('15:25').getAttribute('aria-current')).toBe('true');
    expect(frameAt('16:43').hasAttribute('aria-current')).toBe(false);
    expect(el('[data-role="viewing"]').hidden).toBe(false);
    expect(el('[data-role="viewing"]').textContent).toContain('正在看 15:25 那一則');
  });

  it('brings back what was typed for this moment', () => {
    setup();
    note().value = '這一刻打到一半';
    subtitle().value = '改過的台詞';
    frameAt('12:05').click();
    frameAt('16:43').click();
    expect(note().value).toBe('這一刻打到一半');
    expect(subtitle().value).toBe('改過的台詞');
    expect(el('[data-role="time"]').textContent).toBe('16:43');
    expect(mainThumb().getAttribute('src')).toBe('blob:thumb-1');
    expect(el('[data-role="viewing"]').hidden).toBe(true);
  });

  it('stores edits of an earlier note when switching away or pressing Enter, and stays open', async () => {
    const { h, onEditPrevious } = setup();
    frameAt('15:25').click();
    note().value = '伏筆，後來回收';
    frameAt('12:05').click();
    expect(onEditPrevious).toHaveBeenCalledWith('b', { subtitle: '台詞b', body: '伏筆，後來回收' });
    note().value = '補一句';
    press(note(), { key: 'Enter' });
    expect(onEditPrevious).toHaveBeenLastCalledWith('a', { subtitle: '台詞a', body: '補一句' });
    expect(el('[data-role="time"]').textContent).toBe('16:43');
    expect(await isPending(h.result)).toBe(true);
  });

  it('does not report an earlier note that was only looked at', () => {
    const { onEditPrevious } = setup();
    frameAt('15:25').click();
    el<HTMLButtonElement>('[data-role="back"]').click();
    expect(onEditPrevious).not.toHaveBeenCalled();
    expect(el('[data-role="time"]').textContent).toBe('16:43');
  });

  it('drops the edits and comes back on Esc, without closing', async () => {
    const { h, onEditPrevious } = setup();
    frameAt('15:25').click();
    note().value = '不要了';
    press(note(), { key: 'Escape' });
    expect(onEditPrevious).not.toHaveBeenCalled();
    expect(el('[data-role="time"]').textContent).toBe('16:43');
    expect(await isPending(h.result)).toBe(true);
    // a second Esc, now on this moment, cancels as usual
    press(note(), { key: 'Escape' });
    await expect(h.result).resolves.toEqual({ action: 'cancel' });
  });

  it('remembers the edit when coming back to the same earlier note', () => {
    setup();
    frameAt('15:25').click();
    note().value = '第二次改';
    frameAt('16:43').click();
    frameAt('15:25').click();
    expect(note().value).toBe('第二次改');
  });

  it('hides the picture box for an earlier note without one', () => {
    const h = open();
    h.showPrevious([earlier('x', 1000, '', null)]);
    frameAt('0:01').click();
    expect(mainThumb().classList.contains('blank')).toBe(true);
  });

  it('switches with the keyboard too', () => {
    setup();
    frameAt('15:25').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(el('[data-role="time"]').textContent).toBe('15:25');
  });
});

describe('clicking the dimmed backdrop', () => {
  const host = () => mount.querySelector<HTMLElement>('[data-scenenote-overlay]')!;
  function clickFrom(down: Element, up: Element = down) {
    down.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true }));
    up.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
  }

  it('cancels like Esc', async () => {
    const h = open();
    clickFrom(host());
    await expect(h.result).resolves.toEqual({ action: 'cancel' });
  });

  it('does not cancel on clicks inside the panel', async () => {
    const h = open();
    clickFrom(note());
    clickFrom(el('[data-role="heading"]'));
    clickFrom(el('.panel'));
    expect(await isPending(h.result)).toBe(true);
  });

  it('does not cancel when a press inside the panel is released on the backdrop', async () => {
    const h = open();
    clickFrom(note(), host());
    expect(await isPending(h.result)).toBe(true);
  });

  it('mentions it in the key hints', () => {
    open();
    expect(el('.hint').textContent).toContain('點外面取消');
  });
});

describe('showError and reopenResult', () => {
  it('keeps the overlay open with the typed text and shows the error', async () => {
    const h = open();
    subtitle().value = '改過的台詞';
    note().value = '我打了很多字';
    press(note(), { key: 'Enter' });
    await h.result;

    h.showError('存檔失敗：x');

    expect(h.isOpen()).toBe(true);
    expect(mount.querySelector('[data-scenenote-overlay]')).not.toBeNull();
    expect(note().value).toBe('我打了很多字');
    expect(subtitle().value).toBe('改過的台詞');
    expect(el('[data-role="error"]').textContent).toBe('存檔失敗：x');
  });

  it('reopenResult resolves on the next Enter with the current text', async () => {
    const h = open();
    note().value = '第一版';
    press(note(), { key: 'Enter' });
    await h.result;
    h.showError('存檔失敗：x');

    const again = h.reopenResult();
    expect(await isPending(again)).toBe(true);

    note().value = '第二版';
    press(note(), { key: 'Enter' });
    await expect(again).resolves.toEqual({ action: 'save', subtitle: '你好嗎', body: '第二版' });
  });

  it('works when reopenResult is called before showError', async () => {
    const h = open();
    press(note(), { key: 'Enter' });
    await h.result;
    const again = h.reopenResult();
    h.showError('存檔失敗：y');
    press(note(), { key: 'Enter' });
    await expect(again).resolves.toMatchObject({ action: 'save' });
  });

  it('does not lose an Enter pressed after showError but before reopenResult is called', async () => {
    const h = open();
    press(note(), { key: 'Enter' });
    await h.result;
    h.showError('存檔失敗：x');

    note().value = '趕在 reopenResult 之前按的';
    press(note(), { key: 'Enter' });

    await expect(h.reopenResult()).resolves.toEqual({
      action: 'save',
      subtitle: '你好嗎',
      body: '趕在 reopenResult 之前按的',
    });
  });

  it('reopenResult resolves with cancel on Esc after an error', async () => {
    const h = open();
    press(note(), { key: 'Enter' });
    await h.result;
    h.showError('存檔失敗：x');
    const again = h.reopenResult();
    press(note(), { key: 'Escape' });
    await expect(again).resolves.toEqual({ action: 'cancel' });
  });

  it('can show a second error and clears nothing the user typed', async () => {
    const h = open();
    note().value = '保留我';
    press(note(), { key: 'Enter' });
    await h.result;
    h.showError('存檔失敗：一');
    const again = h.reopenResult();
    press(note(), { key: 'Enter' });
    await again;
    h.showError('存檔失敗：二');
    expect(el('[data-role="error"]').textContent).toBe('存檔失敗：二');
    expect(note().value).toBe('保留我');
  });

  it('shows no error element content before any error', () => {
    open();
    const err = shadow().querySelector('[data-role="error"]');
    expect(err?.textContent ?? '').toBe('');
  });
});

describe('notebook link and close', () => {
  it('calls onOpenNotebook when the notebook link is clicked, without closing or resolving', async () => {
    const h = open();
    el('[data-role="open-notebook"]').click();
    expect(onOpenNotebook).toHaveBeenCalledTimes(1);
    expect(h.isOpen()).toBe(true);
    expect(await isPending(h.result)).toBe(true);
  });

  it('labels the notebook link in Chinese', () => {
    open();
    expect(el('[data-role="open-notebook"]').textContent).toBe('開啟筆記本');
  });

  it('close removes the host element and isOpen turns false', () => {
    const h = open();
    h.close();
    expect(mount.querySelector('[data-scenenote-overlay]')).toBeNull();
    expect(h.isOpen()).toBe(false);
  });

  it('isOpen turns false when the page removes the host from the document', () => {
    const h = open();
    expect(h.isOpen()).toBe(true);
    mount.replaceChildren(); // e.g. Netflix re-rendering the player container
    expect(h.isOpen()).toBe(false);
  });

  it('isOpen turns false when the whole mount is taken out of the document', () => {
    const h = open();
    mount.remove();
    expect(h.isOpen()).toBe(false);
  });

  it('close is idempotent and showError after close does not throw', () => {
    const h = open();
    h.close();
    expect(() => h.close()).not.toThrow();
    expect(() => h.showError('晚了')).not.toThrow();
    expect(h.isOpen()).toBe(false);
  });
});
