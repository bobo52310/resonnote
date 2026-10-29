import { contentRect } from '../../core/capture-math';
import { hidePlayerUi } from '../../core/hide-ui';
import type { Missing, Playback, Rect } from '../../core/types';
import { askBridge, warnOnce } from '../bridge-protocol';
import type { PlatformAdapter } from '../types';
import { parseDisneySubtitle } from './metadata';
import { deepQueryAll, extractSubtitle } from './subtitle';
import { parseWatchVideoId, watchUrl } from './url';

/** Part of the picture, so they stay on screen: the video and the subtitle layer. */
const KEEP_ON_SCREEN = 'video, timed-text-override-region';

/** The page bridge checks a seek for up to 1.5 s before it answers. */
const SEEK_TIMEOUT_MS = 2500;

/** The play-position slider inside a `progress-bar` element; `aria-valuenow` is in seconds. */
const PROGRESS_SLIDER = '.progress-bar__seekable-range[aria-valuenow], [role="slider"][aria-valuenow]';
const TAB_TITLE_SUFFIX = /\s*[|｜]\s*Disney\+?\s*$/i;

interface BridgePlayback {
  videoId: string;
  timeMs: number;
  title: string;
  subtitle: string;
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
  const { videoId, timeMs, title, subtitle } = value;
  if (typeof videoId !== 'string' || videoId === '' || !finiteNumber(timeMs)) return null;
  return {
    videoId,
    timeMs,
    title: typeof title === 'string' ? title.trim() : '',
    subtitle: typeof subtitle === 'string' ? subtitle : '',
  };
}

export function createDisneyAdapter(doc: Document): PlatformAdapter {
  // Everything is read at call time: Disney+ is a single-page app, so the same content
  // script instance outlives a change of title.

  /** The video that plays the title. The page keeps a second, 0x0 `<video>` that does nothing. */
  const findVideo = (): HTMLVideoElement | null => {
    const sized = Array.from(doc.querySelectorAll('video')).filter((video) => {
      const box = video.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    return sized.find((video) => video.matches('.hive-video, [id^="hivePlayer"]')) ?? sized[0] ?? null;
  };

  /** The tab title without " | Disney+", or '' when that leaves nothing (home page, "Disney+"). */
  const tabTitle = (): string => {
    const title = doc.title.replace(TAB_TITLE_SUFFIX, '').trim();
    return title === 'Disney+' ? '' : title;
  };

  const placeholderTitle = (videoId: string) => `Disney+ ${videoId.slice(0, 8)}`;

  /**
   * Programme time in seconds from the progress bar, which exists only while the controls are
   * showing. Not `<video>.currentTime`: on Disney+ that is not the programme time.
   */
  const progressBarMs = (): number | null => {
    for (const bar of deepQueryAll(doc, 'progress-bar')) {
      for (const root of [bar, bar.shadowRoot]) {
        if (!root) continue;
        for (const slider of deepQueryAll(root, PROGRESS_SLIDER)) {
          // Number('') is 0: an empty attribute must not read as "0:00".
          const raw = slider.getAttribute('aria-valuenow')?.trim() ?? '';
          const seconds = raw === '' ? Number.NaN : Number(raw);
          if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
        }
      }
    }
    return null;
  };

  const fallbackPlayback = () => {
    const videoId = parseWatchVideoId(doc.location?.href);
    if (videoId === null) return null;
    const timeMs = progressBarMs();
    if (timeMs === null) return null;
    const playback: Playback = { videoId, title: tabTitle() || placeholderTitle(videoId), timeMs };
    const missing: Missing[] = ['playerApi', 'title'];
    return { playback, missing };
  };

  return {
    async getPlayback() {
      try {
        const answer = parseBridgePlayback(await askBridge<unknown>('playback'));
        if (answer === null) return fallbackPlayback();

        const missing: Missing[] = [];
        let title = answer.title;
        if (title === '') {
          missing.push('title');
          title = tabTitle() || placeholderTitle(answer.videoId);
        }
        const playback: Playback = {
          videoId: answer.videoId,
          timeMs: answer.timeMs,
          title,
          ...parseDisneySubtitle(answer.subtitle),
        };
        return { playback, missing };
      } catch (error) {
        warnOnce('getPlayback', error);
        return null;
      }
    },

    getSubtitleText() {
      return extractSubtitle(doc);
    },

    // The controls below go through the bridge only: pausing or seeking the <video> directly
    // leaves Disney+'s own player state out of step with it.
    pause: async () => (await askBridge<boolean>('pause')) === true,

    play: async () => (await askBridge<boolean>('play')) === true,

    async seek(timeMs) {
      if (!finiteNumber(timeMs)) return false;
      return (await askBridge<boolean>('seek', timeMs, SEEK_TIMEOUT_MS)) === true;
    },

    getVideoRect(): Rect | null {
      try {
        const video = findVideo();
        if (video === null) return null;
        const { videoWidth, videoHeight } = video;
        // contentRect hands the box back unchanged while the size is unknown; that is not the picture.
        if (!(videoWidth > 0) || !(videoHeight > 0)) return null;
        const box = video.getBoundingClientRect();
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
        return hidePlayerUi(doc.fullscreenElement ?? doc.body, KEEP_ON_SCREEN);
      } catch (error) {
        warnOnce('hidePlayerUi', error);
        return () => {};
      }
    },

    // Disney+ has no scrubber image to read, and the video is DRM-protected (no grabFrame either).
    getTrickplayFrame: async () => null,

    watchUrl,
  };
}
