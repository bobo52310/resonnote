import { formatTime } from '../format';
import type { RecentNote } from '../messages';
import type { Missing } from '../types';

export const MISSING_LABELS: Record<Missing, string> = {
  fullFrame: '完整畫面截不到，改用進度條小圖',
  image: '沒有截到圖',
  subtitle: '沒抓到台詞',
  title: '沒抓到片名',
  playerApi: 'Netflix 播放器介面讀不到，秒數改從影片讀',
  useShortcutOnce: '畫面上的按鈕截不到完整畫面：請先在這個分頁按一次快捷鍵或工具列的 ResonNote 圖示，之後按鈕就能截完整畫面',
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
  /**
   * Stacks up to two earlier notes of the same video behind the new picture, newest nearest.
   * Does nothing when the overlay has no picture or is closed.
   */
  showPrevious(notes: RecentNote[]): void;
}

export interface OverlayOptions {
  mount: Element;
  thumbUrl: string | null;
  heading: string;
  time: string;
  subtitle: string;
  missing: Missing[];
  onOpenNotebook: () => void;
  /** An earlier note (opened from the film strip) was edited in the overlay and should be stored. */
  onEditPrevious?: (id: string, changes: { subtitle: string; body: string }) => void;
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
/* Film strip of the earlier notes of this video: oldest left, this moment at the right end. */
.film {
  --hole: rgba(235, 225, 205, 0.85);
  position: relative;
  margin: -4px -4px 14px;
  padding: 16px 14px;
  border-radius: 4px;
  background: linear-gradient(180deg, #1c1813, #0f0d0a 50%, #1c1813);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06), 0 4px 14px rgba(0, 0, 0, 0.5);
  transform: rotate(-0.6deg);
}
/* Sprocket holes along both edges. */
.film::before,
.film::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 6px;
  background: repeating-linear-gradient(90deg, var(--hole) 0 8px, transparent 8px 18px);
  -webkit-mask: radial-gradient(circle at 50% 50%, #000 60%, transparent 62%) 0 0 / 18px 6px;
  border-radius: 2px;
  opacity: 0.8;
}
.film::before {
  top: 5px;
}
.film::after {
  bottom: 5px;
}
.film-body {
  display: flex;
  align-items: center;
  gap: 16px;
}
.frames {
  display: flex;
  flex: none;
  align-items: flex-end;
  gap: 8px;
}
.frame {
  position: relative;
  flex: none;
  margin: 0;
  border: 2px solid #000;
  border-radius: 2px;
  background: #2a2620;
  aspect-ratio: 16 / 9;
  overflow: hidden;
}
.frame img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: sepia(0.25) saturate(0.9);
}
.frame[data-age='2'] {
  height: 72px;
  opacity: 0.75;
}
.frame[data-age='1'] {
  height: 88px;
  opacity: 0.9;
}
.frame.now {
  height: 104px;
}
.frame {
  cursor: pointer;
  transition: border-color 0.15s ease, opacity 0.15s ease;
}
.frame:hover,
.frame:focus-visible {
  border-color: rgba(255, 181, 71, 0.8);
  opacity: 1;
  outline: none;
}
/* The note the panel is showing. */
.frame[aria-current='true'] {
  border-color: #e50914;
  opacity: 1;
}
.viewing {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(255, 181, 71, 0.14);
  color: #ffd79a;
  font-size: 13px;
}
.viewing[hidden] {
  display: none;
}
.viewing span {
  flex: 1;
}
.back {
  padding: 2px 10px;
  border: 1px solid rgba(255, 215, 154, 0.5);
  border-radius: 4px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.back:hover {
  background: rgba(255, 215, 154, 0.15);
}
.thumb.blank {
  visibility: hidden;
}
.frame.now img {
  filter: none;
}
/* Edge code: the time printed on the film under each frame. */
.frame-time {
  position: absolute;
  left: 4px;
  bottom: 2px;
  color: #ffb547;
  font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
  text-shadow: 0 1px 2px #000;
}
.frame.now .frame-time {
  color: #fff;
}
.frame.now .frame-time::before {
  content: '● ';
  color: #e50914;
}
.arrow {
  align-self: center;
  color: rgba(235, 225, 205, 0.45);
  font-size: 14px;
}
.film-caption {
  flex: 1;
  min-width: 0;
  color: #d9cfbd;
  font-size: 13px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.film-caption b {
  display: block;
  color: #ffb547;
  font: 600 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
}
@starting-style {
  .film {
    opacity: 0;
    transform: translateX(24px) rotate(-0.6deg);
  }
}
.film {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
@media (prefers-reduced-motion: reduce) {
  .film {
    transition: none;
  }
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

  let mainThumb: HTMLImageElement | null = null;
  if (opts.thumbUrl !== null) {
    mainThumb = create('img', 'thumb', 'thumb');
    mainThumb.setAttribute('src', opts.thumbUrl);
    mainThumb.alt = '';
    top.appendChild(mainThumb);
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

  const HINT_NOW = 'Enter 存檔並繼續播放　Shift+Enter 換行　Esc 或點外面取消';
  const HINT_EARLIER = 'Enter 存修改並回到這一刻　Shift+Enter 換行　Esc 不存修改、回到這一刻';
  const hint = create('div', 'hint');
  hint.textContent = HINT_NOW;

  // Shown while an earlier note from the film strip is in the panel instead of this moment.
  const viewing = create('div', 'viewing', 'viewing');
  viewing.hidden = true;
  const viewingText = create('span');
  const backButton = create('button', 'back', 'back');
  backButton.type = 'button';
  backButton.textContent = '回到這一刻';
  viewing.append(viewingText, backButton);

  panel.append(viewing, top, noteEl, hint);

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

  // --- earlier notes from the film strip -----------------------------------
  /** The earlier note in the panel, or null while it shows this moment. */
  let viewed: RecentNote | null = null;
  /** What was typed for this moment, kept while an earlier note is in the panel. */
  let nowDraft = { subtitle: opts.subtitle, body: '' };
  /** Called after every switch so the film strip can mark the note in the panel. */
  let markCurrent: () => void = () => {};

  /** Hands edits of the earlier note in the panel to the caller, if there are any. */
  const commitViewed = (): void => {
    if (viewed === null) return;
    const subtitle = subtitleEl.value.trimEnd();
    const body = noteEl.value.trimEnd();
    if (subtitle === viewed.subtitle.trimEnd() && body === viewed.body.trimEnd()) return;
    viewed.subtitle = subtitle;
    viewed.body = body;
    opts.onEditPrevious?.(viewed.id, { subtitle, body });
  };

  /** Puts `target` (null: this moment) in the panel; edits of the earlier one are kept if `keep`. */
  const switchTo = (target: RecentNote | null, keep: boolean): void => {
    if (target === viewed) return;
    if (viewed === null) nowDraft = { subtitle: subtitleEl.value, body: noteEl.value };
    else if (keep) commitViewed();
    viewed = target;
    if (target === null) {
      subtitleEl.value = nowDraft.subtitle;
      noteEl.value = nowDraft.body;
      time.textContent = opts.time;
      mainThumb?.setAttribute('src', opts.thumbUrl ?? '');
      mainThumb?.classList.remove('blank');
      noteEl.placeholder = '寫下這一刻的心得（可以留空）';
      viewing.hidden = true;
      hint.textContent = HINT_NOW;
    } else {
      const at = formatTime(target.timeMs);
      subtitleEl.value = target.subtitle;
      noteEl.value = target.body;
      time.textContent = at;
      mainThumb?.setAttribute('src', target.thumb ?? '');
      mainThumb?.classList.toggle('blank', target.thumb === null);
      noteEl.placeholder = '這一則的心得（可以留空）';
      viewingText.textContent = `正在看 ${at} 那一則，可以直接修改`;
      viewing.hidden = false;
      hint.textContent = HINT_EARLIER;
    }
    markCurrent();
    noteEl.focus();
  };
  backButton.addEventListener('click', () => switchTo(null, true));

  // --- keyboard -----------------------------------------------------------
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    const composing = isComposingKey(e);

    if (e.key === 'Escape') {
      if (composing) return; // Esc only dismisses the IME candidate window
      e.preventDefault();
      // With an earlier note in the panel, Esc only drops its edits and comes back to this moment.
      if (viewed !== null) switchTo(null, false);
      else settle({ action: 'cancel' });
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      if (e.target === noteEl && viewed !== null) {
        e.preventDefault();
        switchTo(null, true);
      } else if (e.target === noteEl) {
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
    if (pressedOnBackdrop && onBackdrop(e)) {
      // Leaving the overlay keeps what was changed in an earlier note, like switching does.
      commitViewed();
      settle({ action: 'cancel' });
    }
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
    showPrevious(notes) {
      if (!open || opts.thumbUrl === null) return;
      if (viewed !== null) switchTo(null, true);
      panel.querySelector('.film')?.remove();
      // Copies: edits made in the overlay are written into them.
      const shown = notes.slice(0, 2).map((note) => ({ ...note }));
      if (shown.length === 0) return;

      const film = create('div', 'film', 'film');
      const body = create('div', 'film-body');
      const frames = create('div', 'frames');
      const caption = create('div', 'film-caption');
      const wordsOf = (note: RecentNote) => note.body.trim() || note.subtitle.trim();
      const showCaption = (at: string, words: string) => {
        const code = create('b');
        code.textContent = at;
        caption.replaceChildren(code, doc.createTextNode(words));
      };
      const entries: Array<{ frame: HTMLElement; note: RecentNote | null }> = [];

      const addFrame = (note: RecentNote | null) => {
        const frame = create('figure', 'frame');
        const thumb = note === null ? opts.thumbUrl : note.thumb;
        const at = note === null ? opts.time : formatTime(note.timeMs);
        if (thumb !== null) {
          const img = create('img');
          img.setAttribute('src', thumb);
          img.alt = '';
          frame.appendChild(img);
        }
        const code = create('span', 'frame-time');
        code.textContent = at;
        frame.appendChild(code);
        frame.tabIndex = 0;
        frame.setAttribute('role', 'button');
        frame.setAttribute('aria-label', note === null ? `回到這一刻 ${at}` : `切換到 ${at} 那一則`);
        frame.addEventListener('mouseenter', () => {
          const words = note === null ? '這一刻' : wordsOf(note);
          showCaption(at, words);
        });
        frame.addEventListener('click', () => switchTo(note, true));
        frame.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          switchTo(note, true);
        });
        if (frames.childElementCount > 0) {
          const arrow = create('span', 'arrow');
          arrow.textContent = '›';
          frames.appendChild(arrow);
        }
        frames.appendChild(frame);
        entries.push({ frame, note });
        return frame;
      };

      // Oldest first, so the strip reads left to right like the film runs.
      [...shown].reverse().forEach((note, i) => {
        const frame = addFrame(note);
        frame.setAttribute('data-role', 'previous');
        frame.setAttribute('data-age', String(shown.length - i));
      });
      addFrame(null).classList.add('now');

      markCurrent = () => {
        for (const { frame, note } of entries) {
          if (note === viewed) frame.setAttribute('aria-current', 'true');
          else frame.removeAttribute('aria-current');
          frame.title = note === null ? `${opts.time}　這一刻` : `${formatTime(note.timeMs)}　${wordsOf(note)}`.trim();
        }
      };
      markCurrent();

      // At rest the caption tells the latest earlier note; hovering a frame shows that one.
      const latest = shown[0]!;
      const showLatest = () => showCaption(formatTime(latest.timeMs), wordsOf(latest));
      showLatest();
      frames.addEventListener('mouseleave', showLatest);

      body.append(frames, caption);
      film.append(body);
      panel.insertBefore(film, panel.firstChild);
    },
  };
}
