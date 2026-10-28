import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { callBridge } from '../../../src/platforms/netflix/bridge-protocol';
import { installPageBridge } from '../../../src/platforms/netflix/page-bridge';

const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_SIZE = 64;

/** A small BIF: 64-byte header, (count + 1) index entries, then the frame bytes. */
function makeBif(frames: Uint8Array[], intervalMs: number): ArrayBuffer {
  const count = frames.length;
  const dataStart = HEADER_SIZE + (count + 1) * 8;
  const total = dataStart + frames.reduce((n, f) => n + f.length, 0);
  const buf = new ArrayBuffer(total);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  bytes.set(MAGIC, 0);
  view.setUint32(12, count, true);
  view.setUint32(16, intervalMs, true);
  let offset = dataStart;
  frames.forEach((frame, i) => {
    view.setUint32(HEADER_SIZE + i * 8, i, true);
    view.setUint32(HEADER_SIZE + i * 8 + 4, offset, true);
    bytes.set(frame, offset);
    offset += frame.length;
  });
  view.setUint32(HEADER_SIZE + count * 8, 0xffffffff, true);
  view.setUint32(HEADER_SIZE + count * 8 + 4, offset, true);
  return buf;
}

const MOVIE_ID = 83053998;
const MOVIE = { type: 'movie', title: '造山者－世紀的賭注', id: MOVIE_ID };

interface FakePlayer {
  getMovieId: () => number;
  getCurrentTime: () => number;
  seek: (ms: number) => void;
  pause: () => void;
  play: () => void;
  getTrickPlayFrame: (ms: number) => unknown;
}

function makePlayer(overrides: Partial<FakePlayer> = {}): FakePlayer {
  return {
    getMovieId: () => MOVIE_ID,
    getCurrentTime: () => 1003469,
    seek: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    getTrickPlayFrame: () => undefined,
    ...overrides,
  };
}

/** A fake `netflix` global; the newest session (last id) is the one that should be used. */
function installNetflix(player: FakePlayer, metadata: Record<string, unknown> = { [MOVIE_ID]: { _metadata: { video: MOVIE } } }) {
  const stalePlayer = makePlayer({ getMovieId: () => 1, getCurrentTime: () => 5 });
  (window as unknown as { netflix?: unknown }).netflix = {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({
            videoPlayer: {
              getAllPlayerSessionIds: () => ['watch-old', 'watch-new'],
              getVideoPlayerBySessionId: (id: string) => (id === 'watch-new' ? player : stalePlayer),
            },
          }),
          getState: () => ({ videoPlayer: { videoMetadata: metadata } }),
        },
      },
    },
  };
}

function removeNetflix() {
  delete (window as unknown as { netflix?: unknown }).netflix;
}

let bifCounter = 0;
const nextBifUrl = () => `https://occ-0-1.nflxso.net/tp/${++bifCounter}/clip.bif?v=3&e=9`;

function stubBif(url: string, buf: ArrayBuffer | null) {
  vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
    { name: 'https://assets.nflxext.com/a.js' } as PerformanceEntry,
    { name: url } as PerformanceEntry,
    { name: 'https://assets.nflxext.com/b.css' } as PerformanceEntry,
  ]);
  const fetchMock = vi.fn(async () =>
    buf === null ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, arrayBuffer: async () => buf },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  removeNetflix();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Must stay first: the shared happy-dom window has no page bridge until the next describe installs one.
describe('callBridge without a page bridge', () => {
  it('resolves null after the timeout', async () => {
    const started = Date.now();
    expect(await callBridge('playback', undefined, 40)).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(30);
  });
});

describe('page bridge', () => {
  beforeAll(() => installPageBridge(window));

  it('answers playback from the newest player session', async () => {
    installNetflix(makePlayer());
    expect(await callBridge('playback')).toEqual({
      videoId: '83053998',
      timeMs: 1003469,
      meta: { title: '造山者－世紀的賭注' },
    });
  });

  it('still answers playback when the metadata cannot be read', async () => {
    installNetflix(makePlayer(), {});
    expect(await callBridge('playback')).toEqual({ videoId: '83053998', timeMs: 1003469, meta: null });
  });

  it('answers null when there is no netflix global, no session or a bad time', async () => {
    expect(await callBridge('playback')).toBeNull();

    installNetflix(makePlayer({ getCurrentTime: () => Number.NaN }));
    expect(await callBridge('playback')).toBeNull();

    (window as unknown as { netflix?: unknown }).netflix = {
      appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => [] } }) } } },
    };
    expect(await callBridge('playback')).toBeNull();
  });

  it('answers null instead of failing when the netflix global throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.defineProperty(window, 'netflix', {
      configurable: true,
      get() {
        throw new Error('boom');
      },
    });
    try {
      expect(await callBridge('playback')).toBeNull();
      expect(await callBridge('seek', 1000)).toBe(false); // a different op than the log-once test below
    } finally {
      delete (window as unknown as { netflix?: unknown }).netflix;
    }
  });

  it('passes pause, play and seek to the player', async () => {
    const player = makePlayer();
    installNetflix(player);
    expect(await callBridge('pause')).toBe(true);
    expect(await callBridge('play')).toBe(true);
    expect(await callBridge('seek', 600000)).toBe(true);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.seek).toHaveBeenCalledWith(600000);
  });

  it('refuses to seek without a finite time', async () => {
    const player = makePlayer();
    installNetflix(player);
    expect(await callBridge('seek')).toBe(false);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('answers false and logs once when the player throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installNetflix(
      makePlayer({
        pause: () => {
          throw new Error('player gone');
        },
      }),
    );
    expect(await callBridge('pause')).toBe(false);
    expect(await callBridge('pause')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[scenenote\]/);
  });

  it('is installed once even when asked twice', async () => {
    const player = makePlayer();
    installNetflix(player);
    installPageBridge(window);
    await callBridge('play');
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('returns the player trickplay image untouched when it starts with FF D8', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const getTrickPlayFrame = vi.fn(() => ({ image: jpeg, time: 1000, width: 320, height: 180 }));
    installNetflix(makePlayer({ getTrickPlayFrame }));
    const fetchMock = stubBif(nextBifUrl(), null);

    const result = await callBridge<Uint8Array>('trickplay', 1003469);
    expect(Array.from(result ?? [])).toEqual(Array.from(jpeg));
    expect(getTrickPlayFrame).toHaveBeenCalledWith(1003469);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the BIF file when the player image is not a JPEG', async () => {
    const bif = makeBif(
      [new Uint8Array([0xff, 0xd8, 1]), new Uint8Array([0xff, 0xd8, 2]), new Uint8Array([0xff, 0xd8, 3])],
      10000,
    );
    const url = nextBifUrl();
    const fetchMock = stubBif(url, bif);
    installNetflix(makePlayer({ getTrickPlayFrame: () => ({ image: new Uint8Array([0, 0, 9, 9]) }) }));

    const result = await callBridge<Uint8Array>('trickplay', 12000);
    expect(Array.from(result ?? [])).toEqual([0xff, 0xd8, 2]);
    expect(fetchMock).toHaveBeenCalledWith(url);

    // Same URL again: served from the cached buffer, no second download.
    const other = await callBridge<Uint8Array>('trickplay', 25000);
    expect(Array.from(other ?? [])).toEqual([0xff, 0xd8, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the newest .bif resource entry', async () => {
    const bif = makeBif([new Uint8Array([0xff, 0xd8, 7])], 10000);
    const oldUrl = nextBifUrl();
    const newUrl = nextBifUrl();
    const fetchMock = stubBif(newUrl, bif);
    vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([
      { name: oldUrl } as PerformanceEntry,
      { name: newUrl } as PerformanceEntry,
    ]);
    installNetflix(makePlayer());

    const result = await callBridge<Uint8Array>('trickplay', 0);
    expect(Array.from(result ?? [])).toEqual([0xff, 0xd8, 7]);
    expect(fetchMock).toHaveBeenCalledWith(newUrl);
  });

  it('answers null when neither the player nor a BIF file has an image', async () => {
    installNetflix(makePlayer({ getTrickPlayFrame: () => ({ image: new Uint8Array([0, 0]) }) }));
    vi.spyOn(window.performance, 'getEntriesByType').mockReturnValue([{ name: 'https://x.example/a.js' } as PerformanceEntry]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await callBridge('trickplay', 1000)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers null for a failed download and retries it next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = nextBifUrl();
    const bif = makeBif([new Uint8Array([0xff, 0xd8, 5])], 10000);
    installNetflix(makePlayer());
    stubBif(url, null);
    expect(await callBridge('trickplay', 0)).toBeNull();

    const fetchMock = stubBif(url, bif);
    const result = await callBridge<Uint8Array>('trickplay', 0);
    expect(Array.from(result ?? [])).toEqual([0xff, 0xd8, 5]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1); // the failed attempt was logged once
  });

  it('answers null when the downloaded file is not a BIF', async () => {
    const url = nextBifUrl();
    installNetflix(makePlayer());
    stubBif(url, new ArrayBuffer(200));
    expect(await callBridge('trickplay', 0)).toBeNull();
  });

  it('ignores malformed requests and forged responses', async () => {
    const player = makePlayer();
    installNetflix(player);
    const origin = window.location.origin;
    window.postMessage({ source: 'scenenote-req', id: 'x', op: 'launch-missiles' }, origin);
    window.postMessage({ source: 'scenenote-req', op: 'pause' }, origin);
    window.postMessage({ source: 'someone-else', id: 'x', op: 'pause' }, origin);
    window.postMessage('pause', origin);
    window.postMessage(null, origin);

    const pending = callBridge('playback');
    window.postMessage({ source: 'scenenote-res', id: 'not-my-id', result: 'forged' }, origin);
    window.postMessage({ source: 'other-res', id: 'whatever', result: 'forged' }, origin);
    expect(await pending).toEqual({ videoId: '83053998', timeMs: 1003469, meta: { title: '造山者－世紀的賭注' } });
    expect(player.pause).not.toHaveBeenCalled();
  });
});
