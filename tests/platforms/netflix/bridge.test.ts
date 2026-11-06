import { Window } from 'happy-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { callBridge } from '../../../src/platforms/bridge-protocol';
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

/** A fake `netflix` global with several player sessions, listed in the given order. */
function installSessions(sessions: [id: string, player: FakePlayer][]) {
  const byId = new Map(sessions);
  (window as unknown as { netflix?: unknown }).netflix = {
    appContext: {
      state: {
        playerApp: {
          getAPI: () => ({
            videoPlayer: {
              getAllPlayerSessionIds: () => sessions.map(([id]) => id),
              getVideoPlayerBySessionId: (id: string) => byId.get(id),
            },
          }),
          getState: () => ({ videoPlayer: { videoMetadata: {} } }),
        },
      },
    },
  };
}

function removeNetflix() {
  delete (window as unknown as { netflix?: unknown }).netflix;
}

const HOME_URL = 'http://localhost:3000/';
function setPageUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
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

// No test reaches the network: the title download fails unless a test says otherwise.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});

afterEach(() => {
  setPageUrl(HOME_URL);
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

  it('downloads the title from Netflix when the player state has none', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ video: { ...MOVIE, id: 7001 } }) }));
    vi.stubGlobal('fetch', fetchMock);
    installNetflix(makePlayer({ getMovieId: () => 7001 }), {});
    expect(await callBridge('playback')).toEqual({ videoId: '7001', timeMs: 1003469, meta: { title: '造山者－世紀的賭注' } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/nq/website/memberapi/release/metadata?movieid=7001');
    // cached: a second capture does not download again
    await callBridge('playback');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('finds season and episode in the show Netflix answers with for an episode id', async () => {
    const show = {
      type: 'show',
      title: '新手上路',
      id: 83124329,
      seasons: [{ seq: 1, episodes: [{ id: 7101, seq: 1, title: '第 1 集' }, { id: 7102, seq: 2, title: '重新開始' }] }],
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ video: show }) })));
    installNetflix(makePlayer({ getMovieId: () => 7102 }), {});
    expect(await callBridge('playback')).toEqual({
      videoId: '7102',
      timeMs: 1003469,
      meta: { title: '新手上路', season: 1, episode: 2, episodeTitle: '重新開始' },
    });
  });

  it('does not hold up the capture for a slow title download, and uses it next time', async () => {
    let finish!: () => void;
    const answered = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await answered;
        return { ok: true, json: async () => ({ video: { ...MOVIE, id: 7201 } }) };
      }),
    );
    installNetflix(makePlayer({ getMovieId: () => 7201 }), {});
    const started = Date.now();
    expect(await callBridge('playback')).toEqual({ videoId: '7201', timeMs: 1003469, meta: null });
    expect(Date.now() - started).toBeLessThan(950);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await callBridge<{ meta: unknown }>('playback'))?.meta).toEqual({ title: '造山者－世紀的賭注' });
  });

  it('downloads again after a failed title download', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ video: { ...MOVIE, id: 7301 } }) });
    vi.stubGlobal('fetch', fetchMock);
    installNetflix(makePlayer({ getMovieId: () => 7301 }), {});
    expect((await callBridge<{ meta: unknown }>('playback'))?.meta).toBeNull();
    expect((await callBridge<{ meta: unknown }>('playback'))?.meta).toEqual({ title: '造山者－世紀的賭注' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[resonnote\]/);
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

  it('answers null to a frame request: Netflix pictures are DRM-protected', async () => {
    installNetflix(makePlayer());
    expect(await callBridge('frame', undefined, 200)).toBeNull();
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
    window.postMessage({ source: 'resonnote-req', id: 'x', op: 'launch-missiles' }, origin);
    window.postMessage({ source: 'resonnote-req', op: 'pause' }, origin);
    window.postMessage({ source: 'someone-else', id: 'x', op: 'pause' }, origin);
    window.postMessage('pause', origin);
    window.postMessage(null, origin);

    const pending = callBridge('playback');
    window.postMessage({ source: 'resonnote-res', id: 'not-my-id', result: 'forged' }, origin);
    window.postMessage({ source: 'other-res', id: 'whatever', result: 'forged' }, origin);
    expect(await pending).toEqual({ videoId: '83053998', timeMs: 1003469, meta: { title: '造山者－世紀的賭注' } });
    expect(player.pause).not.toHaveBeenCalled();
  });
});

describe('page bridge: who may ask', () => {
  beforeAll(() => installPageBridge(window));

  const request = { source: 'resonnote-req', id: 'x', op: 'pause' };
  const post = (source: MessageEventSource | null, origin: string) =>
    window.dispatchEvent(new MessageEvent('message', { data: request, origin, source }));

  it('ignores requests that another window posted, and answers its own', async () => {
    const player = makePlayer();
    installNetflix(player);
    const frame = new Window();
    try {
      // A frame of another origin on the page can post to this window too.
      post(frame as unknown as MessageEventSource, 'https://evil.example');
      post(null, 'https://evil.example');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(player.pause).not.toHaveBeenCalled();

      post(window, window.location.origin);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(player.pause).toHaveBeenCalledTimes(1);
    } finally {
      await frame.happyDOM.close();
    }
  });

  it('still answers the content script, whose messages come from this window', async () => {
    const player = makePlayer();
    installNetflix(player);
    expect(await callBridge('pause')).toBe(true);
    expect(player.pause).toHaveBeenCalledTimes(1);
  });
});

describe('page bridge with several player sessions', () => {
  // A /browse trailer or a preview can leave its own session in the list, even as the newest.
  const WATCH_ID = 83053998;
  const TRAILER_ID = 70143836;

  function sessionsWithTrailerLast() {
    const watch = makePlayer({ getMovieId: () => WATCH_ID, getCurrentTime: () => 600_000 });
    const trailer = makePlayer({ getMovieId: () => TRAILER_ID, getCurrentTime: () => 4_000 });
    installSessions([
      ['watch-1', watch],
      ['trailer-7', trailer],
    ]);
    return { watch, trailer };
  }

  it('uses the session that plays the title of the watch URL, not the newest one', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}?t=600`);
    sessionsWithTrailerLast();
    const playback = await callBridge<{ videoId: string; timeMs: number }>('playback');
    expect(playback?.videoId).toBe(String(WATCH_ID));
    expect(playback?.timeMs).toBe(600_000);
  });

  it('sends pause, play and seek to that session', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    const { watch, trailer } = sessionsWithTrailerLast();
    expect(await callBridge('pause')).toBe(true);
    expect(await callBridge('play')).toBe(true);
    expect(await callBridge('seek', 123_000)).toBe(true);
    expect(watch.pause).toHaveBeenCalledTimes(1);
    expect(watch.play).toHaveBeenCalledTimes(1);
    expect(watch.seek).toHaveBeenCalledWith(123_000);
    expect(trailer.pause).not.toHaveBeenCalled();
    expect(trailer.play).not.toHaveBeenCalled();
    expect(trailer.seek).not.toHaveBeenCalled();
  });

  it('takes the trickplay frame from that session', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    const jpeg = new Uint8Array([0xff, 0xd8, 9, 9]);
    const watch = makePlayer({
      getMovieId: () => WATCH_ID,
      getTrickPlayFrame: () => ({ image: jpeg }),
    });
    const trailer = makePlayer({
      getMovieId: () => TRAILER_ID,
      getTrickPlayFrame: () => ({ image: new Uint8Array([0xff, 0xd8, 1, 1]) }),
    });
    installSessions([
      ['watch-1', watch],
      ['trailer-7', trailer],
    ]);
    expect(Array.from((await callBridge<Uint8Array>('trickplay', 5000)) ?? [])).toEqual(Array.from(jpeg));
  });

  it('matches a movie id that is not the newest nor the first of several', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    const watch = makePlayer({ getMovieId: () => WATCH_ID, getCurrentTime: () => 42_000 });
    installSessions([
      ['trailer-1', makePlayer({ getMovieId: () => 1 })],
      ['watch-2', watch],
      ['trailer-3', makePlayer({ getMovieId: () => TRAILER_ID })],
    ]);
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(42_000);
  });

  it('skips a session whose player throws while it is being compared', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    const broken = makePlayer({
      getMovieId: () => {
        throw new Error('gone');
      },
    });
    const watch = makePlayer({ getMovieId: () => WATCH_ID, getCurrentTime: () => 7_000 });
    installSessions([
      ['watch-1', watch],
      ['trailer-2', broken],
    ]);
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(7_000);
  });

  it('falls back to the newest session whose id starts with "watch" when no movie id matches', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    installSessions([
      ['watch-old', makePlayer({ getMovieId: () => 11, getCurrentTime: () => 1_000 })],
      ['watch-new', makePlayer({ getMovieId: () => 22, getCurrentTime: () => 2_000 })],
      ['trailer-9', makePlayer({ getMovieId: () => TRAILER_ID, getCurrentTime: () => 3_000 })],
    ]);
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(2_000);
  });

  it('also prefers a "watch" session when the page is not a watch URL (no id to compare)', async () => {
    setPageUrl('https://www.netflix.com/browse');
    installSessions([
      ['watch-1', makePlayer({ getMovieId: () => WATCH_ID, getCurrentTime: () => 9_000 })],
      ['trailer-7', makePlayer({ getMovieId: () => TRAILER_ID, getCurrentTime: () => 4_000 })],
    ]);
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(9_000);
  });

  it('uses the newest session when nothing matches and no id starts with "watch"', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    installSessions([
      ['a', makePlayer({ getMovieId: () => 1, getCurrentTime: () => 1_000 })],
      ['b', makePlayer({ getMovieId: () => 2, getCurrentTime: () => 2_000 })],
    ]);
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(2_000);
  });

  it('still works with a single session', async () => {
    setPageUrl(`https://www.netflix.com/watch/${WATCH_ID}`);
    installSessions([['whatever', makePlayer({ getMovieId: () => WATCH_ID, getCurrentTime: () => 5_000 })]]);
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(5_000);
  });
});
