import type { Missing } from '../types';

export const MISSING_LABELS: Record<Missing, string> = {
  fullFrame: '完整畫面截不到，改用進度條小圖',
  image: '沒有截到圖',
  subtitle: '沒抓到台詞',
  title: '沒抓到片名',
  playerApi: 'Netflix 播放器介面讀不到，秒數改從影片讀',
};

export type OverlayResult =
  | { action: 'save'; subtitle: string; body: string }
  | { action: 'cancel' };

export interface OverlayHandle {
  /** Resolves once, on the first save or cancel. */
  result: Promise<OverlayResult>;
  /** Keeps the overlay open with the typed text and shows an error message. */
  showError(message: string): void;
  /** After showError: a fresh promise resolved by the next save/cancel. */
  reopenResult(): Promise<OverlayResult>;
  close(): void;
  /** False once closed, or once the page has taken the overlay out of the document. */
  isOpen(): boolean;
}

export interface OverlayOptions {
  mount: Element;
  thumbUrl: string | null;
  heading: string;
  time: string;
  subtitle: string;
  missing: Missing[];
  onOpenNotebook: () => void;
}

const HOST_ATTRIBUTE = 'data-scenenote-overlay';

const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
  color: #f5f5f5;
}
.panel {
  box-sizing: border-box;
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  overflow: auto;
  padding: 16px;
  border-radius: 12px;
  background: rgba(20, 20, 20, 0.92);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}
.panel:focus {
  outline: none;
}
.top {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.thumb {
  flex: 0 0 240px;
  width: 240px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 6px;
  background: #000;
}
.info {
  flex: 1;
  min-width: 0;
}
.heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.time {
  margin: 2px 0 8px;
  color: #b3b3b3;
  font-variant-numeric: tabular-nums;
}
textarea {
  box-sizing: border-box;
  display: block;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #555;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  font: inherit;
  resize: vertical;
}
textarea:focus {
  outline: 2px solid #e5a00d;
  outline-offset: 0;
  border-color: transparent;
}
.note {
  margin-top: 12px;
}
.hint {
  margin-top: 6px;
  color: #b3b3b3;
  font-size: 12px;
}
.missing {
  margin: 10px 0 0;
  padding: 0 0 0 18px;
  color: #ffc857;
  font-size: 13px;
}
.error {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(229, 9, 20, 0.2);
  color: #ff8a8a;
}
.error:empty {
  display: none;
}
.footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.link {
  padding: 0;
  border: 0;
  background: none;
  color: #8ab4f8;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
`;

/** Keyboard events that must never reach Netflix's own shortcut handlers. */
const KEYBOARD_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

/** Pointer events that would otherwise toggle playback or fullscreen on the video. */
const POINTER_EVENTS = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
] as const;

interface Deferred {
  promise: Promise<OverlayResult>;
  resolve: (result: OverlayResult) => void;
}

function createDeferred(): Deferred {
  let resolve!: (result: OverlayResult) => void;
  const promise = new Promise<OverlayResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function isComposingKey(e: KeyboardEvent): boolean {
  // keyCode 229 covers Safari-style IME where isComposing is already false.
  return e.isComposing || e.keyCode === 229;
}

export function openOverlay(opts: OverlayOptions): OverlayHandle {
  const doc = opts.mount.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    role?: string,
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (role) node.setAttribute('data-role', role);
    return node;
  };

  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  const root = host.attachShadow({ mode: 'open' });

  const style = doc.createElement('style');
  style.textContent = OVERLAY_CSS;
  root.appendChild(style);

  const panel = create('div', 'panel');
  // Focusable by mouse and script, not by Tab: a click on a non-input part of the panel (heading,
  // time, thumbnail, hints) then focuses the panel instead of dropping focus to <body>, where
  // Space and F would reach Netflix.
  panel.setAttribute('tabindex', '-1');
  const top = create('div', 'top');

  if (opts.thumbUrl !== null) {
    const thumb = create('img', 'thumb', 'thumb');
    thumb.setAttribute('src', opts.thumbUrl);
    thumb.alt = '';
    top.appendChild(thumb);
  }

  const info = create('div', 'info');
  const heading = create('p', 'heading', 'heading');
  heading.textContent = opts.heading;
  const time = create('p', 'time', 'time');
  time.textContent = opts.time;
  const subtitleEl = create('textarea', 'subtitle', 'subtitle');
  subtitleEl.rows = 2;
  subtitleEl.value = opts.subtitle;
  subtitleEl.setAttribute('aria-label', '台詞');
  subtitleEl.placeholder = '（沒有台詞）';
  info.append(heading, time, subtitleEl);
  top.appendChild(info);

  const noteEl = create('textarea', 'note', 'note');
  noteEl.rows = 3;
  noteEl.setAttribute('aria-label', '心得');
  noteEl.placeholder = '寫下這一刻的心得（可以留空）';

  const hint = create('div', 'hint');
  hint.textContent = 'Enter 存檔並繼續播放　Shift+Enter 換行　Esc 或點外面取消';

  panel.append(top, noteEl, hint);

  if (opts.missing.length > 0) {
    const list = create('ul', 'missing', 'missing');
    for (const m of opts.missing) {
      const li = doc.createElement('li');
      li.textContent = MISSING_LABELS[m];
      list.appendChild(li);
    }
    panel.appendChild(list);
  }

  const errorEl = create('div', 'error', 'error');
  errorEl.setAttribute('role', 'alert');
  panel.appendChild(errorEl);

  const footer = create('div', 'footer');
  const notebookLink = create('button', 'link', 'open-notebook');
  notebookLink.type = 'button';
  notebookLink.textContent = '開啟筆記本';
  notebookLink.addEventListener('click', () => opts.onOpenNotebook());
  footer.appendChild(notebookLink);
  panel.appendChild(footer);

  root.appendChild(panel);

  // --- result bookkeeping -------------------------------------------------
  let open = true;
  let deferred = createDeferred();
  let settled = false;
  // True once the current deferred's promise has been given to the caller
  // (`result` is handed out at open; later ones by `reopenResult`).
  let handedOut = true;

  const settle = (result: OverlayResult): void => {
    if (!open || settled) return;
    settled = true;
    deferred.resolve(result);
  };

  /**
   * Replaces the current deferred only if the caller has already seen it
   * resolve. A deferred settled by input the caller has not asked for yet is
   * kept, so an Enter pressed between showError() and reopenResult() is not lost.
   */
  const rearmIfConsumed = (): void => {
    if (settled && handedOut) {
      deferred = createDeferred();
      settled = false;
      handedOut = false;
    }
  };

  // --- keyboard -----------------------------------------------------------
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const composing = isComposingKey(e);

    if (e.key === 'Escape') {
      if (composing) return; // Esc only dismisses the IME candidate window
      e.preventDefault();
      settle({ action: 'cancel' });
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      if (e.target === noteEl) {
        e.preventDefault();
        settle({ action: 'save', subtitle: subtitleEl.value, body: noteEl.value });
      } else if (e.target === subtitleEl) {
        e.preventDefault();
        noteEl.focus();
      }
    }
  });
  for (const type of KEYBOARD_EVENTS) {
    if (type === 'keydown') continue;
    panel.addEventListener(type, (e) => e.stopPropagation());
  }

  // --- pointer: keep clicks on the overlay from toggling playback ---------
  for (const type of POINTER_EVENTS) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }
  // Clicking the dimmed backdrop must not move focus to <body>, where
  // keystrokes would reach Netflix again. A listener on the shadow host sees
  // `e.target` retargeted to the host for events that started inside the
  // shadow tree, so `e.target === host` would also be true for the textareas
  // and buttons and would block focus, caret and selection there. The first
  // entry of the composed path is the real origin.
  const onBackdrop = (e: Event) => {
    const origin = e.composedPath()[0];
    return !(origin instanceof Node) || !panel.contains(origin);
  };
  // A click on the dimmed backdrop cancels, like Esc. Only when the press also started there:
  // a text selection dragged from a box out onto the backdrop must not throw the note away.
  let pressedOnBackdrop = false;
  host.addEventListener('mousedown', (e) => {
    pressedOnBackdrop = onBackdrop(e);
    if (pressedOnBackdrop) e.preventDefault();
  });
  host.addEventListener('click', (e) => {
    if (pressedOnBackdrop && onBackdrop(e)) settle({ action: 'cancel' });
    pressedOnBackdrop = false;
  });

  // --- guards against the page while the overlay is open -----------------
  // Netflix moves focus back to its player now and then (and on some mouse moves). Keys typed
  // after that went to Netflix: Space started the video and the rest of the text was lost.
  // So focus taken outside is taken back to the box the user was in, and keys that land
  // outside the overlay are kept from the page's handlers.
  const win = doc.defaultView;
  let lastFocused: HTMLElement = noteEl;
  root.addEventListener('focusin', (e) => {
    const origin = e.composedPath()[0];
    if (origin instanceof HTMLElement && panel.contains(origin)) lastFocused = origin;
  });
  const fromOverlay = (e: Event) => e.composedPath().includes(host);
  const active = () => open && host.isConnected;
  const takeFocusBack = () => {
    if (active()) lastFocused.focus({ preventScroll: true });
  };
  const onPageFocusIn = (e: FocusEvent) => {
    if (active() && !fromOverlay(e)) takeFocusBack();
  };
  // A plain blur() moves focus to <body> without any focusin; check once the move is done.
  const onOverlayFocusOut = () => {
    setTimeout(() => {
      if (!active() || !doc.hasFocus()) return;
      if (doc.activeElement !== host) takeFocusBack();
    }, 0);
  };
  const onPageKey = (e: Event) => {
    if (active() && !fromOverlay(e)) e.stopImmediatePropagation();
  };
  doc.addEventListener('focusin', onPageFocusIn, true);
  root.addEventListener('focusout', onOverlayFocusOut);
  for (const type of KEYBOARD_EVENTS) win?.addEventListener(type, onPageKey, true);
  const removeGuards = () => {
    doc.removeEventListener('focusin', onPageFocusIn, true);
    for (const type of KEYBOARD_EVENTS) win?.removeEventListener(type, onPageKey, true);
  };

  opts.mount.appendChild(host);
  noteEl.focus();

  return {
    result: deferred.promise,
    showError(message) {
      if (!open) return;
      errorEl.textContent = message;
      rearmIfConsumed();
    },
    reopenResult() {
      rearmIfConsumed();
      handedOut = true;
      return deferred.promise;
    },
    close() {
      if (!open) return;
      open = false;
      removeGuards();
      host.remove();
    },
    // A host the page removed (without a save or cancel) must not keep the capture "busy" for ever.
    isOpen: () => open && host.isConnected,
  };
}
