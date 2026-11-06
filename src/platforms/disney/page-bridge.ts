/**
 * Runs in the page's own JS world (MAIN), the only place Disney+'s player API exists.
 * Answers `callBridge` requests that the isolated-world content script posts to this window.
 *
 * Everything goes through `disney-web-player`'s `mediaPlayer`. The `<video>` is no help: its
 * `currentTime` counts from the start of the current media buffer (measured 2026-10-29: 70 s on
 * the video while the player showed 0:49, and it restarts near 22 after a seek), so it is neither
 * read nor written here.
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

const INSTALLED = Symbol.for('resonnote.page-bridge');

/** How often, and for how long, a seek is checked against the player's own clock. */
const SEEK_POLL_MS = 150;
const SEEK_VERIFY_MS = 1500;
/** How far from the target the playhead may be and still count as arrived. */
const SEEK_TOLERANCE_MS = 3000;

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

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The player object (re-read on every call: the single-page app replaces it between titles), or `null`. */
function getPlayer(win: Window): unknown {
  return dig(win.document.querySelector('disney-web-player'), 'mediaPlayer') ?? null;
}

/** `NOTREADY` is the state before the stream has loaded; the clock and the metadata mean nothing yet. */
function isNotReady(player: unknown): boolean {
  return dig(player, 'playbackStatus', 'currentState') === 'NOTREADY';
}

/** Programme time in ms (not the `<video>` time), or `null` when the player cannot say. */
function playheadMs(player: unknown): number | null {
  const ms = dig(player, 'timeline', 'info', 'playheadPositionMs');
  return finiteNumber(ms) && ms >= 0 ? ms : null;
}

function playback(win: Window) {
  const player = getPlayer(win);
  if (!player || isNotReady(player)) return null;
  // The player does not know the play id the URL carries, so the URL is the source of it.
  const videoId = parseWatchVideoId(win.location.href);
  const timeMs = playheadMs(player);
  if (videoId === null || timeMs === null) return null;
  const metadata = dig(player, 'mediaPlaybackCriteria', 'metadata');
  return {
    videoId,
    timeMs: Math.round(timeMs),
    title: text(dig(metadata, 'title', 'text')),
    // 「第 1 季第 2 集：…」 for an episode, '' for a movie.
    subtitle: text(dig(metadata, 'subtitle', 'text')),
    state: text(dig(player, 'playbackStatus', 'currentState')),
  };
}

/** pause()/play() may hand back a promise; a rejection (or a missing method) throws, which counts as false. */
async function pausePlay(win: Window, method: 'pause' | 'play'): Promise<boolean> {
  const player = getPlayer(win);
  if (!player) return false;
  await call(player, method);
  return true;
}

/**
 * A seek in the first PAUSED state after the page loads is ignored without any error (measured
 * 2026-10-29), so `seek` returning is no proof. The player's clock is read again until it is near
 * the target; the caller can retry when this says false.
 */
async function seek(win: Window, timeMs: number | undefined): Promise<boolean> {
  if (!finiteNumber(timeMs)) return false;
  const player = getPlayer(win);
  if (!player || isNotReady(player)) return false;

  const target = Math.max(0, Math.round(timeMs));
  const result = call(player, 'seek', target);
  // Returns undefined today; if a later version returns a promise, its rejection must not go unhandled.
  void Promise.resolve(result).catch((error: unknown) => warnOnce('player seek result', error));

  for (let waited = 0; waited < SEEK_VERIFY_MS; waited += SEEK_POLL_MS) {
    await sleep(SEEK_POLL_MS);
    const now = playheadMs(getPlayer(win));
    if (now !== null && Math.abs(now - target) < SEEK_TOLERANCE_MS) return true;
  }
  return false;
}

async function handle(win: Window, request: BridgeRequest): Promise<unknown> {
  switch (request.op) {
    case 'playback':
      return playback(win);
    case 'pause':
    case 'play':
      return pausePlay(win, request.op);
    case 'seek':
      return seek(win, request.timeMs);
    case 'trickplay':
    case 'frame':
      // No scrubber image to read (the preview only exists while the pointer is on the bar), and
      // the video is DRM-protected, so a canvas draw would only come out black.
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
    // Only this window's own requests (the content script's): a frame of another origin on the
    // page can post to this window too, and must not drive the player. Chrome sets `source` to
    // the sending window, which is `win` for a window posting to itself.
    if (event.source !== win) return;
    const data: unknown = event.data;
    if (isBridgeRequest(data)) void respond(win, data);
  });
}
