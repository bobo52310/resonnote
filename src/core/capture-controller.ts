import type { PlatformAdapter } from '../platforms/types';
import type { cropAndCheck } from './crop';
import { formatTime, noteHeading } from './format';
import type { BeginResult, RecentNote, SaveResult, ToBackground } from './messages';
import type { OverlayHandle, OverlayResult, openOverlay } from './overlay/overlay';
import type { ImageSource, Missing, Note, Platform, Playback, Rect } from './types';

export interface CaptureControllerDeps {
  adapter: PlatformAdapter;
  /** The site the adapter reads; written into every note. */
  platform: Platform;
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
      console.warn('[resonnote] could not show the player controls again', error);
    }
  }

  async function hideUiForScreenshot(): Promise<void> {
    restoreUi();
    try {
      restoreUiNow = adapter.hidePlayerUi();
    } catch (error) {
      console.warn('[resonnote] could not hide the player controls', error);
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

  /**
   * The cropped screenshot if it is usable, else the frame the adapter drew from the <video>
   * (full quality, no subtitles), else the scrubber image, else nothing.
   */
  async function pickPicture(state: Snapshot, dataUrl: string | null): Promise<Picture> {
    if (dataUrl !== null && state.rect !== null) {
      try {
        const crop = await deps.cropAndCheck(dataUrl, state.rect, state.dpr);
        if (!crop.blocked && crop.width > 0 && crop.height > 0 && crop.dataUrl !== '') {
          return { source: 'tab', dataUrl: crop.dataUrl, width: crop.width, height: crop.height, missing: null };
        }
      } catch (error) {
        console.warn('[resonnote] could not crop the screenshot', error);
      }
    }
    if (adapter.grabFrame !== undefined) {
      try {
        const bytes = await adapter.grabFrame();
        if (bytes !== null) {
          const image = await deps.jpegBytesToDataUrl(bytes);
          // Only the black-frame check is wanted from the crop; the picture itself is kept as drawn.
          const check = await deps.cropAndCheck(
            image.dataUrl,
            { x: 0, y: 0, width: image.width, height: image.height },
            1,
          );
          if (!check.blocked && image.width > 0 && image.height > 0) {
            return { source: 'frame', dataUrl: image.dataUrl, width: image.width, height: image.height, missing: null };
          }
        }
      } catch (error) {
        console.warn('[resonnote] could not use the frame drawn from the video', error);
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
      console.warn('[resonnote] could not use the scrubber image', error);
    }
    return { source: 'none', dataUrl: null, width: 0, height: 0, missing: 'image' };
  }

  /** Sends a write to the background and reads its answer; no answer counts as a failure. */
  async function request(msg: ToBackground): Promise<SaveResult> {
    try {
      const reply = await deps.sendToBackground(msg);
      if (reply && reply.ok) return { ok: true };
      if (reply && !reply.ok) return reply;
      // No reply at all: nobody confirmed the write, so do not close the overlay on it.
      return { ok: false, error: '背景程式沒有回應' };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  const send = (note: Note, imageDataUrl: string | null) =>
    request({ type: 'resonnote/save', note, imageDataUrl });

  // Numbers the strip reloads. Only the newest one is applied: a slower, older answer would put
  // back a note that was deleted since.
  let stripLoads = 0;

  /**
   * Loads the newest earlier notes of the video into the overlay's film strip. Failures are only
   * logged: the strip is a convenience. An empty list is handed over only when asked, so the strip
   * can go away after the last note was deleted.
   */
  async function reloadStrip(
    handle: OverlayHandle,
    videoId: string,
    { applyEmpty }: { applyEmpty: boolean },
  ): Promise<void> {
    const load = ++stripLoads;
    try {
      const notes = await deps.loadRecent(videoId);
      if (load !== stripLoads) return;
      if (notes.length > 0 || applyEmpty) handle.showPrevious(notes);
    } catch (error) {
      console.warn('[resonnote] could not load the earlier notes', error);
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
      console.error('[resonnote] the note overlay failed', error);
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
      // Only a low-quality or missing picture is worth the tip: a tab screenshot or a drawn frame is fine.
      if (hint === 'use-shortcut-once' && (picture.source === 'trickplay' || picture.source === 'none')) {
        missing.push('useShortcutOnce');
      }
      const id = deps.uuid();
      const createdAt = deps.now().toISOString();
      const makeNote = (typed: Extract<OverlayResult, { action: 'save' }>): Note => ({
        ...state.playback,
        id,
        platform: deps.platform,
        // Trailing spaces and blank lines would show up as empty blocks in the exports.
        subtitle: typed.subtitle.trimEnd(),
        body: typed.body.trimEnd(),
        image: { source: picture.source, width: picture.width, height: picture.height },
        createdAt,
        updatedAt: createdAt,
      });
      // Assigned right below; the overlay only calls back after a user action.
      let editedHandle: OverlayHandle | null = null;
      const handle = deps.openOverlay({
        mount: deps.mount(),
        thumbUrl: picture.dataUrl,
        heading: noteHeading(state.playback),
        time: formatTime(state.playback.timeMs),
        subtitle: state.subtitle,
        missing,
        onEditPrevious: (id, changes) => {
          void request({ type: 'resonnote/update', id, ...changes }).then((outcome) => {
            if (!outcome.ok) editedHandle?.showError('那一則的修改沒有存到：' + outcome.error);
          });
        },
        onDeletePrevious: (id) => {
          void request({ type: 'resonnote/delete', id }).then(async (outcome) => {
            if (!outcome.ok) editedHandle?.showError('那一則沒有刪掉：' + outcome.error);
            // Either way the strip shows what is stored now: a note that was not deleted comes back.
            if (editedHandle !== null) {
              await reloadStrip(editedHandle, state.playback.videoId, { applyEmpty: true });
            }
          });
        },
        onOpenNotebook: () => {
          deps.sendToBackground({ type: 'resonnote/open-notebook' }).catch((error: unknown) => {
            console.warn('[resonnote] could not open the notebook', error);
          });
        },
      });
      overlay = handle;
      editedHandle = handle;
      // Not awaited: the earlier notes slide in when they are ready, the user can type meanwhile.
      void reloadStrip(handle, state.playback.videoId, { applyEmpty: false });
      // Not awaited: the user may take minutes, and the caller only needs to know the overlay is up.
      void converse(handle, makeNote, picture.dataUrl).catch((error: unknown) => {
        console.error('[resonnote] the note overlay failed', error);
      });
    } catch (error) {
      console.error('[resonnote] could not open the note overlay', error);
      await adapter.play();
      return;
    } finally {
      working = false;
    }
  }

  return { begin, show, isBusy };
}
