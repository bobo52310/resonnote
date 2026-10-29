import type { PlatformAdapter } from '../platforms/types';
import type { cropAndCheck } from './crop';
import { formatTime, noteHeading } from './format';
import type { BeginResult, RecentNote, SaveResult, ToBackground } from './messages';
import type { OverlayHandle, OverlayResult, openOverlay } from './overlay/overlay';
import type { ImageSource, Missing, Note, Playback, Rect } from './types';

export interface CaptureControllerDeps {
  adapter: PlatformAdapter;
  cropAndCheck: typeof cropAndCheck;
  jpegBytesToDataUrl: (bytes: Uint8Array) => Promise<{ dataUrl: string; width: number; height: number }>;
  openOverlay: typeof openOverlay;
  sendToBackground: (msg: ToBackground) => Promise<SaveResult | void>;
  /** The newest earlier notes of a video (newest first), shown stacked behind the new picture. */
  loadRecent: (videoId: string) => Promise<RecentNote[]>;
  /** Where the overlay goes: `document.fullscreenElement ?? document.body`. */
  mount: () => Element;
  dpr: () => number;
  /** Resolves once the page has painted what was just changed, so a screenshot will show it. */
  nextFrame: () => Promise<void>;
  now: () => Date;
  uuid: () => string;
}

export interface CaptureController {
  /**
   * Reads the page (playback, subtitle, video position) and hides the player's controls until
   * `show` (or a safety timeout) so the screenshot taken next shows only the scene. Does not
   * touch the video.
   */
  begin(): Promise<BeginResult>;
  /**
   * Pauses, picks the picture and opens the note overlay. Resolves once the overlay is on
   * screen; saving or cancelling afterwards is handled in the background of this call.
   */
  show(dataUrl: string | null, hint?: 'use-shortcut-once'): Promise<void>;
  /** True while a capture is being prepared or its overlay is open. */
  isBusy(): boolean;
}

/** What `begin` read from the page, waiting for the screenshot to arrive in `show`. */
interface Snapshot {
  playback: Playback;
  missing: Missing[];
  subtitle: string;
  rect: Rect | null;
  dpr: number;
}

interface Picture {
  source: ImageSource;
  dataUrl: string | null;
  width: number;
  height: number;
  /** Added to the overlay's "what is missing" list; null when the picture is complete. */
  missing: Missing | null;
}

/** Brings the controls back if `show` never comes (for example the screenshot step failed). */
export const PLAYER_UI_RESTORE_MS = 3000;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createCaptureController(deps: CaptureControllerDeps): CaptureController {
  const { adapter } = deps;
  let snapshot: Snapshot | null = null;
  let overlay: OverlayHandle | null = null;
  // True while begin() or show() is between its first await and its end, so a second
  // trigger in that window is turned away instead of racing the first one.
  let working = false;

  const isBusy = () => working || (overlay?.isOpen() ?? false);

  let restoreUiTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreUiNow: (() => void) | null = null;

  function restoreUi(): void {
    if (restoreUiTimer !== null) clearTimeout(restoreUiTimer);
    restoreUiTimer = null;
    const restore = restoreUiNow;
    restoreUiNow = null;
    try {
      restore?.();
    } catch (error) {
      console.warn('[scenenote] could not show the player controls again', error);
    }
  }

  async function hideUiForScreenshot(): Promise<void> {
    restoreUi();
    try {
      restoreUiNow = adapter.hidePlayerUi();
    } catch (error) {
      console.warn('[scenenote] could not hide the player controls', error);
      return;
    }
    restoreUiTimer = setTimeout(restoreUi, PLAYER_UI_RESTORE_MS);
    await deps.nextFrame();
  }

  async function begin(): Promise<BeginResult> {
    if (isBusy()) return { status: 'busy' };
    working = true;
    try {
      const current = await adapter.getPlayback();
      if (current === null) {
        snapshot = null;
        return { status: 'no-video' };
      }
      const subtitle = adapter.getSubtitleText();
      const missing = [...current.missing];
      if (subtitle === '' && !missing.includes('subtitle')) missing.push('subtitle');
      snapshot = {
        playback: current.playback,
        missing,
        subtitle,
        rect: adapter.getVideoRect(),
        dpr: deps.dpr(),
      };
      await hideUiForScreenshot();
      return { status: 'ok' };
    } finally {
      working = false;
    }
  }

  /** The cropped screenshot if it is usable, else the scrubber image, else nothing. */
  async function pickPicture(state: Snapshot, dataUrl: string | null): Promise<Picture> {
    if (dataUrl !== null && state.rect !== null) {
      try {
        const crop = await deps.cropAndCheck(dataUrl, state.rect, state.dpr);
        if (!crop.blocked && crop.width > 0 && crop.height > 0 && crop.dataUrl !== '') {
          return { source: 'tab', dataUrl: crop.dataUrl, width: crop.width, height: crop.height, missing: null };
        }
      } catch (error) {
        console.warn('[scenenote] could not crop the screenshot', error);
      }
    }
    try {
      const bytes = await adapter.getTrickplayFrame(state.playback.timeMs);
      if (bytes !== null) {
        const image = await deps.jpegBytesToDataUrl(bytes);
        return {
          source: 'trickplay',
          dataUrl: image.dataUrl,
          width: image.width,
          height: image.height,
          missing: 'fullFrame',
        };
      }
    } catch (error) {
      console.warn('[scenenote] could not use the scrubber image', error);
    }
    return { source: 'none', dataUrl: null, width: 0, height: 0, missing: 'image' };
  }

  async function send(note: Note, imageDataUrl: string | null): Promise<SaveResult> {
    try {
      const reply = await deps.sendToBackground({ type: 'scenenote/save', note, imageDataUrl });
      if (reply && reply.ok) return { ok: true };
      if (reply && !reply.ok) return reply;
      // No reply at all: nobody confirmed the write, so do not close the overlay on it.
      return { ok: false, error: '背景程式沒有回應' };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /** Runs until the user saves or cancels; a failed save keeps the overlay open for another try. */
  async function converse(
    handle: OverlayHandle,
    makeNote: (typed: Extract<OverlayResult, { action: 'save' }>) => Note,
    imageDataUrl: string | null,
  ): Promise<void> {
    try {
      let result = await handle.result;
      while (result.action === 'save') {
        const outcome = await send(makeNote(result), imageDataUrl);
        if (outcome.ok) return;
        handle.showError('存檔失敗：' + outcome.error);
        result = await handle.reopenResult();
      }
    } catch (error) {
      console.error('[scenenote] the note overlay failed', error);
    } finally {
      handle.close();
      await adapter.play();
    }
  }

  async function show(dataUrl: string | null, hint?: 'use-shortcut-once'): Promise<void> {
    // The screenshot has been taken by now (or failed): the controls can come back.
    restoreUi();
    const state = snapshot;
    if (state === null || isBusy()) return;
    snapshot = null;
    working = true;

    try {
      await adapter.pause();
      const picture = await pickPicture(state, dataUrl);
      const missing = picture.missing === null ? [...state.missing] : [...state.missing, picture.missing];
      if (hint === 'use-shortcut-once' && picture.source !== 'tab') missing.push('useShortcutOnce');
      const id = deps.uuid();
      const createdAt = deps.now().toISOString();
      const makeNote = (typed: Extract<OverlayResult, { action: 'save' }>): Note => ({
        ...state.playback,
        id,
        platform: 'netflix',
        // Trailing spaces and blank lines would show up as empty blocks in the exports.
        subtitle: typed.subtitle.trimEnd(),
        body: typed.body.trimEnd(),
        image: { source: picture.source, width: picture.width, height: picture.height },
        createdAt,
        updatedAt: createdAt,
      });
      const handle = deps.openOverlay({
        mount: deps.mount(),
        thumbUrl: picture.dataUrl,
        heading: noteHeading(state.playback),
        time: formatTime(state.playback.timeMs),
        subtitle: state.subtitle,
        missing,
        onOpenNotebook: () => {
          deps.sendToBackground({ type: 'scenenote/open-notebook' }).catch((error: unknown) => {
            console.warn('[scenenote] could not open the notebook', error);
          });
        },
      });
      overlay = handle;
      // Not awaited: the earlier notes slide in when they are ready, the user can type meanwhile.
      void deps
        .loadRecent(state.playback.videoId)
        .then((notes) => {
          if (notes.length > 0) handle.showPrevious(notes);
        })
        .catch((error: unknown) => {
          console.warn('[scenenote] could not load the earlier notes', error);
        });
      // Not awaited: the user may take minutes, and the caller only needs to know the overlay is up.
      void converse(handle, makeNote, picture.dataUrl).catch((error: unknown) => {
        console.error('[scenenote] the note overlay failed', error);
      });
    } catch (error) {
      console.error('[scenenote] could not open the note overlay', error);
      await adapter.play();
      return;
    } finally {
      working = false;
    }
  }

  return { begin, show, isBusy };
}
