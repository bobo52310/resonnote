/**
 * Runs in the page's own JS world (MAIN), the only place YouTube's player methods
 * (`getCurrentTime()`, `seekTo()`, …) exist. Answers `callBridge` requests that the
 * isolated-world content script posts to this window.
 */
import {
  RESPONSE_SOURCE,
  isBridgeRequest,
  selfOrigin,
  warnOnce,
  type BridgeRequest,
  type BridgeResponse,
} from '../bridge-protocol';
import { parseWatchVideoId } from './url';

const INSTALLED = Symbol.for('scenenote.page-bridge');

/** A frame is drawn from the video only once it holds picture data (HAVE_CURRENT_DATA). */
const HAVE_CURRENT_DATA = 2;
const JPEG_QUALITY = 0.9;

/** Reads `keys` down from `root`; `undefined` as soon as a step is missing. */
function dig(root: unknown, ...keys: string[]): unknown {
  let node: unknown = root;
  for (const key of keys) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Calls `target[method](...args)`; throws when `target` has no such function. */
function call(target: unknown, method: string, ...args: unknown[]): unknown {
  const fn = dig(target, method);
  if (typeof fn !== 'function') throw new Error(`${method} is not available`);
  return (fn as (...a: unknown[]) => unknown).apply(target, args);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The player element of the page: `#shorts-player` on /shorts/, else `#movie_player`. A Shorts
 * page holds both, and the `#movie_player` one is idle there, so the path decides.
 */
function getPlayer(win: Window): Element | null {
  const id = win.location.pathname.startsWith('/shorts/') ? 'shorts-player' : 'movie_player';
  return win.document.getElementById(id);
}

function playback(win: Window) {
  const player = getPlayer(win);
  if (!player) return null;

  const data = call(player, 'getVideoData');
  const playerId = dig(data, 'video_id');
  // The player knows best which video it plays (the URL changes a moment before it does),
  // but an empty id is no answer: then the URL's has to do.
  const videoId =
    typeof playerId === 'string' && playerId !== '' ? playerId : parseWatchVideoId(win.location.href);
  const seconds = call(player, 'getCurrentTime');
  if (videoId === null || !finiteNumber(seconds)) return null;

  const title = dig(data, 'title');
  return {
    videoId,
    timeMs: Math.round(seconds * 1000),
    title: typeof title === 'string' ? title : '',
    // The clock of an ad is the ad's, not the video's.
    ad: player.classList.contains('ad-showing'),
  };
}

function control(win: Window, method: 'pause' | 'play' | 'seek', timeMs?: number): boolean {
  const player = getPlayer(win);
  if (!player) return false;
  if (method === 'seek') {
    if (!finiteNumber(timeMs)) return false;
    call(player, 'seekTo', timeMs / 1000, true);
  } else {
    call(player, method === 'pause' ? 'pauseVideo' : 'playVideo');
  }
  return true;
}

/**
 * The video's current picture as JPEG bytes, without subtitles or player controls. YouTube video
 * is not DRM-protected, so the canvas is readable. `null` when there is no picture to draw.
 */
async function frame(win: Window): Promise<Uint8Array | null> {
  const player = getPlayer(win);
  const video =
    player?.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    player?.querySelector<HTMLVideoElement>('video');
  if (!video) return null;
  const { videoWidth, videoHeight } = video;
  if (!(videoWidth > 0) || !(videoHeight > 0) || video.readyState < HAVE_CURRENT_DATA) return null;

  const canvas = win.document.createElement('canvas');
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(video, 0, 0, videoWidth, videoHeight);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : null;
}

async function handle(win: Window, request: BridgeRequest): Promise<unknown> {
  switch (request.op) {
    case 'playback':
      return playback(win);
    case 'pause':
    case 'play':
    case 'seek':
      return control(win, request.op, request.timeMs);
    case 'frame':
      return frame(win);
    case 'trickplay':
      // YouTube's scrubber previews are not used: `frame` is the better picture.
      return null;
  }
}

async function respond(win: Window, request: BridgeRequest): Promise<void> {
  let result: unknown;
  try {
    result = await handle(win, request);
  } catch (error) {
    warnOnce(`player ${request.op}`, error);
    result = request.op === 'pause' || request.op === 'play' || request.op === 'seek' ? false : null;
  }
  const response: BridgeResponse = { source: RESPONSE_SOURCE, id: request.id, result };
  try {
    win.postMessage(response, selfOrigin(win));
  } catch (error) {
    warnOnce('bridge response', error);
  }
}

/** Starts answering bridge requests on `win`. Safe to call twice: later calls do nothing. */
export function installPageBridge(win: Window): void {
  const marked = win as unknown as Record<symbol, unknown>;
  if (marked[INSTALLED]) return;
  Object.defineProperty(win, INSTALLED, { value: true });

  win.addEventListener('message', (event: MessageEvent) => {
    const data: unknown = event.data;
    if (isBridgeRequest(data)) void respond(win, data);
  });
}
