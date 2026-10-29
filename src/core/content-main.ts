import { browser } from 'wxt/browser';
import type { PlatformAdapter } from '../platforms/types';
import { createCaptureController } from './capture-controller';
import { cropAndCheck, jpegBytesToDataUrl } from './crop';
import type { BeginResult, RecentNote, SaveResult, ToBackground, ToContent } from './messages';
import { openOverlay } from './overlay/overlay';
import { mountQuickButton, type QuickButtonHandle } from './quick-button';
import type { Platform } from './types';

export interface ContentScriptOptions {
  platform: Platform;
  adapter: PlatformAdapter;
  /**
   * The id of the title the page plays right now (the `videoId` a note would get), or null when
   * it is not a watch page. Asked each time: these sites change pages without reloading. Decides
   * where the quick button shows, and which seeks the page accepts.
   */
  watchVideoId: () => string | null;
  /** The element the quick button sits in (bottom-right corner); omitted = viewport (v1 behaviour). */
  quickButtonAnchor?: () => Element | null;
}

export function isToContent(message: unknown): message is ToContent {
  if (typeof message !== 'object' || message === null) return false;
  const { type } = message as { type?: unknown };
  if (type === 'scenenote/begin') return true;
  if (type === 'scenenote/show') {
    const { dataUrl, hint } = message as { dataUrl?: unknown; hint?: unknown };
    return (
      (dataUrl === null || typeof dataUrl === 'string') &&
      (hint === undefined || hint === 'use-shortcut-once')
    );
  }
  if (type === 'scenenote/seek') {
    const { timeMs, videoId } = message as { timeMs?: unknown; videoId?: unknown };
    return (
      Number.isFinite(timeMs) &&
      (videoId === undefined || (typeof videoId === 'string' && videoId !== ''))
    );
  }
  return false;
}

/**
 * The adapter, except that hiding the player's controls also hides the on-page note button (the
 * button is not inside any site's player, so the adapter cannot reach it), and showing them
 * again brings both back.
 */
function hidingTheButtonToo(
  adapter: PlatformAdapter,
  button: Pick<QuickButtonHandle, 'hideForScreenshot'>,
): PlatformAdapter {
  return {
    ...adapter,
    hidePlayerUi: () => {
      const showButton = button.hideForScreenshot();
      try {
        const showPlayerUi = adapter.hidePlayerUi();
        return () => {
          try {
            showPlayerUi();
          } finally {
            showButton();
          }
        };
      } catch (error) {
        // The capture controller gets no restore function for a failed hide, so none would show it.
        showButton();
        throw error;
      }
    },
  };
}

/**
 * The part of the content script that is the same on every platform: the capture controller,
 * the background messages, the on-page button. Streaming sites are single-page apps, so the
 * script is injected on their non-watch pages too and lives on across navigation; everything
 * about the page is resolved when a message arrives, not at load.
 */
export function runContentScript(opts: ContentScriptOptions): void {
  const { platform, adapter } = opts;

  // Mounted before the controller, which needs the button to hide it for the screenshot. The
  // button asks the controller whether it is busy only when the mouse moves, after both exist.
  const quickButton = mountQuickButton({
    doc: document,
    onPress: () => {
      browser.runtime.sendMessage<ToBackground>({ type: 'scenenote/trigger' }).catch((error: unknown) => {
        console.warn('[scenenote] the note button could not reach the extension', error);
      });
    },
    isWatchPage: () => opts.watchVideoId() !== null,
    isBusy: () => controller.isBusy(),
    anchor: opts.quickButtonAnchor,
  });

  const controller = createCaptureController({
    adapter: hidingTheButtonToo(adapter, quickButton),
    platform,
    cropAndCheck,
    jpegBytesToDataUrl,
    openOverlay,
    sendToBackground: (msg: ToBackground) =>
      browser.runtime.sendMessage<ToBackground, SaveResult | void>(msg),
    loadRecent: async (videoId: string) => {
      const notes = await browser.runtime.sendMessage<ToBackground, RecentNote[] | undefined>({
        type: 'scenenote/recent',
        platform,
        videoId,
        limit: 2,
      });
      return Array.isArray(notes) ? notes : [];
    },
    mount: () => document.fullscreenElement ?? document.body,
    dpr: () => window.devicePixelRatio,
    // Two frames: the first runs before the style change is painted, the second after.
    // The timeout covers a tab that is not painting (requestAnimationFrame never fires).
    nextFrame: () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        setTimeout(resolve, 100);
      }),
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
  });

  /**
   * Seeks and then pauses (so the scene can be looked at); a failed seek leaves playback alone.
   * A seek meant for another title (the page moved on since it was asked for) is declined
   * without touching the player.
   */
  const seekAndPause = async (timeMs: number, videoId: string | undefined): Promise<boolean> => {
    if (videoId !== undefined && videoId !== opts.watchVideoId()) return false;
    const sought = await adapter.seek(timeMs);
    if (sought) await adapter.pause();
    return sought;
  };

  const handle = async (message: ToContent): Promise<unknown> => {
    switch (message.type) {
      case 'scenenote/begin':
        return controller.begin();
      case 'scenenote/show':
        return controller.show(message.dataUrl, message.hint);
      case 'scenenote/seek':
        return seekAndPause(message.timeMs, message.videoId);
    }
  };

  browser.runtime
    .sendMessage<ToBackground, string | undefined>({ type: 'scenenote/shortcut' })
    .then((shortcut) => quickButton.setShortcut(typeof shortcut === 'string' ? shortcut : ''))
    .catch(() => quickButton.setShortcut(''));

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isToContent(message)) return;
    handle(message).then(sendResponse, (error: unknown) => {
      console.error('[scenenote] could not handle', message.type, error);
      sendResponse(
        message.type === 'scenenote/begin'
          ? ({ status: 'no-video' } satisfies BeginResult)
          : undefined,
      );
    });
    return true;
  });
}
