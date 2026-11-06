/**
 * Runs in the page's own JS world (MAIN), the only place Netflix's player API exists.
 * Answers `callBridge` requests that the isolated-world content script posts to this window.
 */
import {
  RESPONSE_SOURCE,
  isBridgeRequest,
  selfOrigin,
  warnOnce,
  type BridgeRequest,
  type BridgeResponse,
} from '../bridge-protocol';
import { bifFrame, parseBif, type BifIndex } from './bif';
import { mapNetflixMetadata } from './metadata';
import { parseWatchVideoId } from './url';

const INSTALLED = Symbol.for('resonnote.page-bridge');
const BIF_URL = /\.bif(\?|$)/;

/**
 * Netflix's own title endpoint. Since late 2026 the player state's `videoMetadata` is often empty,
 * so this is where titles come from then. For an episode id it answers with the whole show
 * (`seasons[].seq`, `seasons[].episodes[].{id, seq, title}`), measured 2026-10-29.
 */
const metadataUrl = (movieId: number) => `/nq/website/memberapi/release/metadata?movieid=${movieId}`;
/** How long a capture waits for a title that is not loaded yet; it must not hold up the screenshot. */
const META_WAIT_MS = 600;
const META_CACHE_SIZE = 50;

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

/** The player of one session, or `null` when Netflix has none for that id (or it throws). */
function sessionPlayer(videoPlayer: unknown, id: unknown): unknown {
  try {
    return call(videoPlayer, 'getVideoPlayerBySessionId', id) ?? null;
  } catch {
    return null;
  }
}

/** Whether `player` is playing the title with this video id; a player that throws counts as no. */
function plays(player: unknown, videoId: string): boolean {
  try {
    return String(call(player, 'getMovieId')) === videoId;
  } catch {
    return false;
  }
}

/**
 * The player that plays what the page shows, or `null` when Netflix has none (yet). A trailer or
 * preview started on /browse can leave its own session in the list (even as the newest), so the
 * newest session is only the last resort. In order of preference:
 *   1. the session whose movie id is the one in the watch URL;
 *   2. the newest session whose id starts with `watch` (Netflix names the real player's that way);
 *   3. the newest session.
 */
function getPlayer(win: Window): unknown {
  const playerApp = dig(win, 'netflix', 'appContext', 'state', 'playerApp');
  if (!playerApp) return null;
  const videoPlayer = dig(call(playerApp, 'getAPI'), 'videoPlayer');
  const ids: unknown = call(videoPlayer, 'getAllPlayerSessionIds');
  if (!Array.isArray(ids) || ids.length === 0) return null;

  const watchId = parseWatchVideoId(win.location.href);
  if (watchId !== null) {
    for (let i = ids.length - 1; i >= 0; i--) {
      const player = sessionPlayer(videoPlayer, ids[i]);
      if (player && plays(player, watchId)) return player;
    }
  }
  for (let i = ids.length - 1; i >= 0; i--) {
    const id: unknown = ids[i];
    if (typeof id !== 'string' || !id.startsWith('watch')) continue;
    const player = sessionPlayer(videoPlayer, id);
    if (player) return player;
  }
  return call(videoPlayer, 'getVideoPlayerBySessionId', ids[ids.length - 1]) ?? null;
}

type Meta = ReturnType<typeof mapNetflixMetadata>;

/** The title from the player state, when Netflix still keeps it there. */
function readStateMeta(win: Window, movieId: number): Meta {
  try {
    const playerApp = dig(win, 'netflix', 'appContext', 'state', 'playerApp');
    const state = call(playerApp, 'getState');
    const video = dig(state, 'videoPlayer', 'videoMetadata', String(movieId), '_metadata', 'video');
    return mapNetflixMetadata(video, movieId);
  } catch (error) {
    warnOnce('read title metadata', error);
    return null;
  }
}

/** Titles by movie id, newest last. A failed download is dropped so the next capture retries. */
const metaCache = new Map<number, Promise<Meta>>();

/** Downloads (once) the title of `movieId` from Netflix's title endpoint. */
function fetchMeta(win: Window, movieId: number): Promise<Meta> {
  const cached = metaCache.get(movieId);
  if (cached) return cached;
  const loading = (async (): Promise<Meta> => {
    const response = await win.fetch(metadataUrl(movieId), { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return mapNetflixMetadata(dig(await response.json(), 'video'), movieId);
  })().catch((error: unknown) => {
    warnOnce('title metadata download', error);
    return null;
  });
  metaCache.set(movieId, loading);
  if (metaCache.size > META_CACHE_SIZE) {
    const oldest = metaCache.keys().next().value;
    if (oldest !== undefined) metaCache.delete(oldest);
  }
  void loading.then((meta) => {
    if (meta === null && metaCache.get(movieId) === loading) metaCache.delete(movieId);
  });
  return loading;
}

/** The player state's title, else the downloaded one if it arrives within META_WAIT_MS. */
async function readMeta(win: Window, movieId: number): Promise<Meta> {
  const fromState = readStateMeta(win, movieId);
  if (fromState !== null) return fromState;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), META_WAIT_MS);
  });
  try {
    return await Promise.race([fetchMeta(win, movieId), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function playback(win: Window) {
  const player = getPlayer(win);
  if (!player) return null;
  const movieId = call(player, 'getMovieId');
  const timeMs = call(player, 'getCurrentTime');
  if (!finiteNumber(movieId) || !finiteNumber(timeMs)) return null;
  return { videoId: String(movieId), timeMs, meta: await readMeta(win, movieId) };
}

function control(win: Window, method: 'pause' | 'play' | 'seek', timeMs?: number): boolean {
  const player = getPlayer(win);
  if (!player) return false;
  if (method === 'seek') {
    if (!finiteNumber(timeMs)) return false;
    call(player, 'seek', timeMs);
  } else {
    call(player, method);
  }
  return true;
}

/** The bytes when they look like a JPEG (start with FF D8), compacted so a postMessage copies only them. */
function jpegBytes(value: unknown): Uint8Array | null {
  if (!ArrayBuffer.isView(value)) return null;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

interface LoadedBif {
  buf: ArrayBuffer;
  index: BifIndex;
}

/** Only the newest title's BIF is kept (several MB each); a failed load is dropped so it is retried. */
let bifCache: { url: string; loaded: Promise<LoadedBif | null> } | null = null;

function loadBif(win: Window, url: string): Promise<LoadedBif | null> {
  if (bifCache?.url === url) return bifCache.loaded;
  const loaded = (async (): Promise<LoadedBif | null> => {
    const response = await win.fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buf = await response.arrayBuffer();
    const index = parseBif(buf);
    return index ? { buf, index } : null;
  })().catch((error: unknown) => {
    warnOnce('trickplay file download', error);
    return null;
  });
  const entry = { url, loaded };
  bifCache = entry;
  void loaded.then((result) => {
    if (result === null && bifCache === entry) bifCache = null;
  });
  return loaded;
}

function latestBifUrl(win: Window): string | null {
  const entries = win.performance.getEntriesByType('resource');
  for (let i = entries.length - 1; i >= 0; i--) {
    const name = entries[i]?.name;
    if (name !== undefined && BIF_URL.test(name)) return name;
  }
  return null;
}

async function trickplay(win: Window, timeMs: number | undefined): Promise<Uint8Array | null> {
  if (!finiteNumber(timeMs)) return null;

  try {
    const player = getPlayer(win);
    if (player) {
      const fromPlayer = jpegBytes(dig(call(player, 'getTrickPlayFrame', timeMs), 'image'));
      if (fromPlayer) return fromPlayer;
    }
  } catch (error) {
    warnOnce('player trickplay frame', error);
  }

  const url = latestBifUrl(win);
  if (!url) return null;
  const bif = await loadBif(win, url);
  return bif ? bifFrame(bif.buf, bif.index, timeMs) : null;
}

async function handle(win: Window, request: BridgeRequest): Promise<unknown> {
  switch (request.op) {
    case 'playback':
      return playback(win);
    case 'pause':
    case 'play':
    case 'seek':
      return control(win, request.op, request.timeMs);
    case 'trickplay':
      return trickplay(win, request.timeMs);
    case 'frame':
      // Netflix pictures are DRM-protected: a canvas draw would only come out black.
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

  // Netflix changes pages without reloading, so the watch URL is checked now and then and the
  // title of a newly opened video is downloaded ahead of the first capture.
  if (/(^|\.)netflix\.com$/.test(win.location.hostname)) {
    let lastId: string | null = null;
    win.setInterval(() => {
      const id = parseWatchVideoId(win.location.href);
      if (id === null || id === lastId) return;
      lastId = id;
      void fetchMeta(win, Number(id));
    }, 1000);
  }
}
