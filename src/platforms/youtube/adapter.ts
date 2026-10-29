import { contentRect } from '../../core/capture-math';
import { hidePlayerUi } from '../../core/hide-ui';
import type { Missing, Playback, Rect } from '../../core/types';
import { askBridge, warnOnce } from '../bridge-protocol';
import type { PlatformAdapter } from '../types';
import { extractSubtitle } from './subtitle';
import { parseWatchVideoId, watchUrl } from './url';

/** Part of the picture, so they stay on screen: the video and the caption layers. */
const KEEP_ON_SCREEN =
  'video, #ytp-caption-window-container, .ytp-caption-window-container, #lln-main-subs';

/** Drawing a full-size frame and encoding it is slower than a plain player call. */
const FRAME_TIMEOUT_MS = 3000;

interface BridgePlayback {
  videoId: string;
  timeMs: number;
  title: string;
  ad: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Checks the bridge's playback answer; anything off-shape counts as "no answer". */
function parseBridgePlayback(value: unknown): BridgePlayback | null {
  if (!isRecord(value)) return null;
  const { videoId, timeMs, title, ad } = value;
  if (typeof videoId !== 'string' || videoId === '' || !finiteNumber(timeMs)) return null;
  return {
    videoId,
    timeMs,
    title: typeof title === 'string' ? title.trim() : '',
    ad: ad === true,
  };
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value.length > 0 ? value : null;
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

/**
 * The title a tab shows for a video, without the unread-notification count in front and the
 * site name behind: "(107) Inside the Mind … | TED - YouTube" becomes "Inside the Mind … | TED".
 */
function cleanTabTitle(raw: string): string {
  const title = raw
    .trim()
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s+-\s+YouTube$/, '')
    .trim();
  return title === 'YouTube' ? '' : title;
}

/**
 * The player element of the page: `#shorts-player` on /shorts/, else `#movie_player`. A Shorts
 * page holds both, and the `#movie_player` one is idle there (0×0, paused), so the path decides.
 */
export function findPlayer(doc: Document): HTMLElement | null {
  const shorts = doc.location?.pathname.startsWith('/shorts/') === true;
  return doc.getElementById(shorts ? 'shorts-player' : 'movie_player');
}

export function createYouTubeAdapter(doc: Document): PlatformAdapter {
  // Everything is read at call time: YouTube is a single-page app, so the same content
  // script instance outlives a change of video.
  const findVideo = () => {
    const player = findPlayer(doc);
    return (
      player?.querySelector<HTMLVideoElement>('video.html5-main-video') ??
      player?.querySelector<HTMLVideoElement>('video') ??
      null
    );
  };

  const adIsShowing = () => findPlayer(doc)?.classList.contains('ad-showing') === true;

  /** Cleaned tab title, or the video id when that leaves nothing. */
  const fallbackTitle = (videoId: string) => {
    const title = cleanTabTitle(doc.title);
    return title !== '' ? title : `YouTube ${videoId}`;
  };

  const fallbackPlayback = () => {
    const videoId = parseWatchVideoId(doc.location?.href);
    const video = findVideo();
    if (videoId === null || video === null || !finiteNumber(video.currentTime)) return null;
    const playback: Playback = {
      videoId,
      title: fallbackTitle(videoId),
      timeMs: Math.round(video.currentTime * 1000),
    };
    const missing: Missing[] = ['playerApi', 'title'];
    return { playback, missing };
  };

  return {
    async getPlayback() {
      try {
        const answer = parseBridgePlayback(await askBridge<unknown>('playback'));
        // An ad's clock is not the video's: nothing to note while one plays.
        if (answer?.ad === true || adIsShowing()) return null;
        if (answer === null) return fallbackPlayback();

        const missing: Missing[] = [];
        let title = answer.title;
        if (title === '') {
          title = fallbackTitle(answer.videoId);
          missing.push('title');
        }
        return { playback: { videoId: answer.videoId, timeMs: answer.timeMs, title }, missing };
      } catch (error) {
        warnOnce('getPlayback', error);
        return null;
      }
    },

    getSubtitleText() {
      return extractSubtitle(doc, findPlayer(doc) ?? doc);
    },

    async pause() {
      if ((await askBridge<boolean>('pause')) === true) return true;
      try {
        const video = findVideo();
        if (video === null) return false;
        video.pause();
        return true;
      } catch (error) {
        warnOnce('pause', error);
        return false;
      }
    },

    async play() {
      if ((await askBridge<boolean>('play')) === true) return true;
      try {
        const video = findVideo();
        if (video === null) return false;
        await video.play();
        return true;
      } catch (error) {
        warnOnce('play', error);
        return false;
      }
    },

    async seek(timeMs) {
      if (!finiteNumber(timeMs)) return false;
      if ((await askBridge<boolean>('seek', timeMs)) === true) return true;
      // No DRM here, so the element itself can be moved.
      try {
        const video = findVideo();
        if (video === null) return false;
        video.currentTime = timeMs / 1000;
        return true;
      } catch (error) {
        warnOnce('seek', error);
        return false;
      }
    },

    getVideoRect(): Rect | null {
      try {
        const video = findVideo();
        if (video === null) return null;
        const { videoWidth, videoHeight } = video;
        // contentRect hands the box back unchanged while the size is unknown; that is not the picture.
        if (!(videoWidth > 0) || !(videoHeight > 0)) return null;
        const box = video.getBoundingClientRect();
        if (!(box.width > 0) || !(box.height > 0)) return null;
        return contentRect(
          { x: box.left, y: box.top, width: box.width, height: box.height },
          videoWidth,
          videoHeight,
        );
      } catch (error) {
        warnOnce('getVideoRect', error);
        return null;
      }
    },

    hidePlayerUi() {
      try {
        // Only the player's own children, so the rest of the page does not flash. In fullscreen
        // YouTube usually fullscreens the player itself; when something around it is
        // fullscreen instead, that is the root to work in.
        const player = findPlayer(doc);
        const full = doc.fullscreenElement;
        const root = full && (player === null || !full.contains(player)) ? full : player;
        return root ? hidePlayerUi(root, KEEP_ON_SCREEN) : () => {};
      } catch (error) {
        warnOnce('hidePlayerUi', error);
        return () => {};
      }
    },

    // YouTube's scrubber previews are not used: `grabFrame` gives a far better picture.
    async getTrickplayFrame() {
      return null;
    },

    async grabFrame() {
      return toBytes(await askBridge<unknown>('frame', undefined, FRAME_TIMEOUT_MS));
    },

    watchUrl,
  };
}
