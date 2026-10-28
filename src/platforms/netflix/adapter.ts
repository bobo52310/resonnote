import { contentRect } from '../../core/capture-math';
import type { Missing, Playback, Rect } from '../../core/types';
import type { PlatformAdapter } from '../types';
import { callBridge, warnOnce } from './bridge-protocol';
import { extractSubtitle } from './subtitle';
import { parseWatchVideoId, watchUrl } from './url';

/** The first scrubber-image request may have to download the whole BIF file (several MB). */
const TRICKPLAY_TIMEOUT_MS = 10_000;

type Meta = Pick<Playback, 'title' | 'season' | 'episode' | 'episodeTitle'>;
interface BridgePlayback {
  videoId: string;
  timeMs: number;
  meta: Meta | null;
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
  const { videoId, timeMs, meta } = value;
  if (typeof videoId !== 'string' || videoId === '' || !finiteNumber(timeMs)) return null;
  return { videoId, timeMs, meta: parseMeta(meta) };
}

function parseMeta(value: unknown): Meta | null {
  if (!isRecord(value)) return null;
  const { title, season, episode, episodeTitle } = value;
  if (typeof title !== 'string' || title === '') return null;
  const meta: Meta = { title };
  if (finiteNumber(season)) meta.season = season;
  if (finiteNumber(episode)) meta.episode = episode;
  if (typeof episodeTitle === 'string' && episodeTitle !== '') meta.episodeTitle = episodeTitle;
  return meta;
}

/** `callBridge` that cannot reject. */
async function ask<T>(...args: Parameters<typeof callBridge>): Promise<T | null> {
  try {
    return await callBridge<T>(...args);
  } catch (error) {
    warnOnce('bridge call', error);
    return null;
  }
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value.length > 0 ? value : null;
  if (ArrayBuffer.isView(value) && value.byteLength > 0) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function createNetflixAdapter(doc: Document): PlatformAdapter {
  // Everything is read at call time: Netflix is a single-page app, so the same content
  // script instance outlives a change of title.
  const findVideo = () =>
    doc.querySelector<HTMLVideoElement>('[data-uia="video-canvas"] video') ??
    doc.querySelector<HTMLVideoElement>('video');

  /** Tab title, or the video id when the tab is just called "Netflix". */
  const fallbackTitle = (videoId: string) => {
    const tabTitle = doc.title.trim();
    return tabTitle !== '' && tabTitle !== 'Netflix' ? tabTitle : `Netflix ${videoId}`;
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
        const answer = parseBridgePlayback(await ask<unknown>('playback'));
        if (answer === null) return fallbackPlayback();

        const missing: Missing[] = [];
        const meta = answer.meta ?? { title: fallbackTitle(answer.videoId) };
        if (answer.meta === null) missing.push('title');
        return { playback: { videoId: answer.videoId, timeMs: answer.timeMs, ...meta }, missing };
      } catch (error) {
        warnOnce('getPlayback', error);
        return null;
      }
    },

    getSubtitleText() {
      return extractSubtitle(doc);
    },

    async pause() {
      if ((await ask<boolean>('pause')) === true) return true;
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
      if ((await ask<boolean>('play')) === true) return true;
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
      // No <video> fallback: setting currentTime makes Netflix show a playback error.
      if (!finiteNumber(timeMs)) return false;
      return (await ask<boolean>('seek', timeMs)) === true;
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

    async getTrickplayFrame(timeMs) {
      if (!finiteNumber(timeMs)) return null;
      return toBytes(await ask<unknown>('trickplay', timeMs, TRICKPLAY_TIMEOUT_MS));
    },

    watchUrl,
  };
}
