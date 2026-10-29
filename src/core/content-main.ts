import { browser } from 'wxt/browser';
import type { PlatformAdapter } from '../platforms/types';
import { createCaptureController } from './capture-controller';
import { cropAndCheck, jpegBytesToDataUrl } from './crop';
import type { BeginResult, RecentNote, SaveResult, ToBackground, ToContent } from './messages';
import { openOverlay } from './overlay/overlay';
import { mountQuickButton } from './quick-button';
import type { Platform } from './types';

export interface ContentScriptOptions {
  platform: Platform;
  adapter: PlatformAdapter;
  /** Whether the page currently plays something that can be noted (quick button visibility). */
  isWatchPage: () => boolean;
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
    return Number.isFinite((message as { timeMs?: unknown }).timeMs);
  }
  return false;
}

/**
 * The part of the content script that is the same on every platform: the capture controller,
 * the background messages, the on-page button. Streaming sites are single-page apps, so the
 * script is injected on their non-watch pages too and lives on across navigation; everything
 * about the page is resolved when a message arrives, not at load.
 */
export function runContentScript(opts: ContentScriptOptions): void {
  const { platform, adapter } = opts;
  const controller = createCaptureController({
    adapter,
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

  /** Seeks and then pauses (so the scene can be looked at); a failed seek leaves playback alone. */
  const seekAndPause = async (timeMs: number): Promise<boolean> => {
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
        return seekAndPause(message.timeMs);
    }
  };

  const quickButton = mountQuickButton({
    doc: document,
    onPress: () => {
      browser.runtime.sendMessage<ToBackground>({ type: 'scenenote/trigger' }).catch((error: unknown) => {
        console.warn('[scenenote] the note button could not reach the extension', error);
      });
    },
    isWatchPage: opts.isWatchPage,
    isBusy: () => controller.isBusy(),
    anchor: opts.quickButtonAnchor,
  });
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
