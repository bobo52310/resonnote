import { createCaptureController } from '../core/capture-controller';
import { cropAndCheck, jpegBytesToDataUrl } from '../core/crop';
import type { BeginResult, RecentNote, SaveResult, ToBackground, ToContent } from '../core/messages';
import { openOverlay } from '../core/overlay/overlay';
import { mountQuickButton } from '../core/quick-button';
import { parseWatchVideoId } from '../platforms/netflix/url';
import { createNetflixAdapter } from '../platforms/netflix/adapter';

function isToContent(message: unknown): message is ToContent {
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

// Netflix is a single-page app: this script is injected on /browse too and lives on across
// navigation to /watch/…, so everything is resolved when a message arrives, not at load.
export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  main() {
    const adapter = createNetflixAdapter(document);
    const controller = createCaptureController({
      adapter,
      cropAndCheck,
      jpegBytesToDataUrl,
      openOverlay,
      sendToBackground: (msg: ToBackground) =>
        browser.runtime.sendMessage<ToBackground, SaveResult | void>(msg),
      loadRecent: async (videoId: string) => {
        const notes = await browser.runtime.sendMessage<ToBackground, RecentNote[] | undefined>({
          type: 'scenenote/recent',
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
      isWatchPage: () => parseWatchVideoId(location.href) !== null,
      isBusy: () => controller.isBusy(),
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
  },
});
