/**
 * The 「記下這一刻」 button on the player. It behaves like Netflix's own controls: it fades in
 * while the mouse moves and fades out after a few idle seconds, so it never sits on the picture
 * while watching. It lives in its own shadow root on the page (inside the fullscreen element in
 * fullscreen), so the screenshot code hides it with the rest of the player UI.
 */

export interface QuickButtonOptions {
  doc: Document;
  /** Starts a capture (the button only asks; the background does the work). */
  onPress: () => void;
  /** Only shown on watch pages: Netflix changes pages without reloading. */
  isWatchPage: () => boolean;
  /** True while the note overlay is open: the button steps aside. */
  isBusy: () => boolean;
}

export interface QuickButtonHandle {
  /** Shows the shortcut beside the label (for example 「⌥⇧N」); '' hides it. */
  setShortcut(shortcut: string): void;
  destroy(): void;
}

/** How long the button stays after the mouse stops, like Netflix's controls. */
export const IDLE_HIDE_MS = 3000;

const HOST_ATTRIBUTE = 'data-scenenote-button';

const BUTTON_CSS = `
:host {
  all: initial;
  position: fixed;
  right: 32px;
  bottom: 140px;
  z-index: 2147483646;
  pointer-events: none;
}
button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px 9px 13px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(20, 20, 20, 0.72);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: #fff;
  font: 600 15px/1 -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif;
  letter-spacing: 0.02em;
  cursor: pointer;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.15s ease, border-color 0.15s ease;
  pointer-events: none;
}
:host([data-visible]) button {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
button:hover,
button:focus-visible {
  border-color: #e50914;
  background: #e50914;
  outline: none;
}
svg {
  width: 18px;
  height: 18px;
  flex: none;
}
kbd {
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.85);
  font: 500 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
}
kbd:empty {
  display: none;
}
@media (prefers-reduced-motion: reduce) {
  button {
    transition: none;
  }
}
`;

/** A picture frame with a pencil: "note this scene". */
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M14 20.5l1-3.5 6-6 2.5 2.5-6 6z"/></svg>`;

/** Events that would reach Netflix's player (play/pause, fullscreen, shortcuts) if not stopped. */
const STOPPED_EVENTS = [
  'click',
  'dblclick',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'keydown',
  'keyup',
  'keypress',
] as const;

export function mountQuickButton(opts: QuickButtonOptions): QuickButtonHandle {
  const { doc } = opts;

  const host = doc.createElement('div');
  host.setAttribute(HOST_ATTRIBUTE, '');
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = BUTTON_CSS;
  const button = doc.createElement('button');
  button.type = 'button';
  button.innerHTML = ICON;
  const label = doc.createElement('span');
  label.textContent = '記下這一刻';
  const kbd = doc.createElement('kbd');
  button.append(label, kbd);
  button.title = '記下這一刻：截圖、秒數、台詞和你的心得';
  root.append(style, button);

  for (const type of STOPPED_EVENTS) host.addEventListener(type, (e) => e.stopPropagation());
  button.addEventListener('click', () => {
    hide();
    opts.onPress();
  });

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(hideTimer);
    host.removeAttribute('data-visible');
  };

  /** Puts the host where it can be seen: inside the fullscreen element when there is one. */
  const place = () => {
    const parent = doc.fullscreenElement ?? doc.body;
    if (parent && host.parentNode !== parent) parent.appendChild(host);
  };

  const onActivity = () => {
    if (!opts.isWatchPage() || opts.isBusy()) {
      hide();
      return;
    }
    place();
    host.setAttribute('data-visible', '');
    clearTimeout(hideTimer);
    // Stay while the pointer rests on the button itself, like a menu would.
    hideTimer = setTimeout(() => {
      if (!button.matches(':hover')) hide();
      else onActivity();
    }, IDLE_HIDE_MS);
  };

  doc.addEventListener('mousemove', onActivity, { capture: true, passive: true });
  doc.addEventListener('fullscreenchange', place);
  place();

  const updateLabel = (shortcut: string) => {
    kbd.textContent = shortcut;
    button.setAttribute('aria-label', shortcut === '' ? '記下這一刻' : `記下這一刻（${shortcut}）`);
  };
  updateLabel('');

  return {
    setShortcut: updateLabel,
    destroy() {
      hide();
      doc.removeEventListener('mousemove', onActivity, { capture: true });
      doc.removeEventListener('fullscreenchange', place);
      host.remove();
    },
  };
}
