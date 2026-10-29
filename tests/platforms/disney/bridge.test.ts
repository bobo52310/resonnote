import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { callBridge } from '../../../src/platforms/bridge-protocol';
import { installPageBridge } from '../../../src/platforms/disney/page-bridge';

const PLAY_ID = '4b3a1c2e-9f00-4d6b-8a21-0123456789ab';
const PLAY_URL = `https://www.disneyplus.com/zh-hant/play/${PLAY_ID}`;
const HOME_URL = 'http://localhost:3000/';

function setPageUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

interface FakeMediaPlayer {
  playbackStatus: { currentState: string };
  timeline: { info: { playheadPositionMs: number; programDurationMs: number } };
  mediaPlaybackCriteria: { metadata: { title: { text: string }; subtitle: { text: string } } };
  seek: (ms: number) => unknown;
  pause: () => unknown;
  play: () => unknown;
}

/** Shaped like the `mediaPlayer` measured on disneyplus.com 2026-10-29 (0:49 into 《尚公主》 S1E2). */
function makePlayer(overrides: Partial<FakeMediaPlayer> = {}): FakeMediaPlayer {
  const player: FakeMediaPlayer = {
    playbackStatus: { currentState: 'PAUSED' },
    timeline: { info: { playheadPositionMs: 49_000, programDurationMs: 2_693_000 } },
    mediaPlaybackCriteria: {
      metadata: { title: { text: '尚公主' }, subtitle: { text: '第 1 季第 2 集：第2集' } },
    },
    // Like the real one: returns undefined, and the playhead jumps (after a moment, in the real thing).
    seek: vi.fn((ms: number) => {
      player.timeline.info.playheadPositionMs = ms;
    }),
    pause: vi.fn(() => ({})),
    play: vi.fn(() => ({})),
    ...overrides,
  };
  return player;
}

/** Puts `<disney-web-player>` on the page with the given player on its `mediaPlayer` property. */
function mountPlayer(player: unknown) {
  document.body.innerHTML = '<disney-web-player></disney-web-player>';
  (document.querySelector('disney-web-player') as unknown as { mediaPlayer: unknown }).mediaPlayer = player;
}

const ask = <T = unknown>(op: Parameters<typeof callBridge>[0], timeMs?: number) =>
  callBridge<T>(op, timeMs, 5000);

// happy-dom delivers postMessage on real timers, while the seek check waits on the (faked) global
// ones. A test that fakes them lets messages through with `settle`, then moves the clock.
const realSetTimeout = globalThis.setTimeout;
const settle = () => new Promise<void>((resolve) => realSetTimeout(resolve, 20));
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

beforeAll(() => {
  installPageBridge(window);
});

beforeEach(() => {
  setPageUrl(PLAY_URL);
});

afterEach(() => {
  setPageUrl(HOME_URL);
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('playback', () => {
  it('reports the programme time, the title and the season/episode line', async () => {
    mountPlayer(makePlayer());
    expect(await ask('playback')).toEqual({
      videoId: PLAY_ID,
      timeMs: 49_000,
      title: '尚公主',
      subtitle: '第 1 季第 2 集：第2集',
      state: 'PAUSED',
    });
  });

  it('rounds the playhead to whole milliseconds', async () => {
    const player = makePlayer();
    player.timeline.info.playheadPositionMs = 301_820.6;
    mountPlayer(player);
    expect(((await ask('playback')) as { timeMs: number }).timeMs).toBe(301_821);
  });

  it('gives an empty subtitle for a movie', async () => {
    const movie = makePlayer();
    movie.mediaPlaybackCriteria.metadata = { title: { text: '內幕' }, subtitle: { text: '' } };
    mountPlayer(movie);
    expect(await ask('playback')).toMatchObject({ title: '內幕', subtitle: '' });
  });

  it('takes the id from the URL, with or without a locale segment, in lower case', async () => {
    mountPlayer(makePlayer());
    setPageUrl(`https://www.disneyplus.com/play/${PLAY_ID.toUpperCase()}`);
    expect(await ask('playback')).toMatchObject({ videoId: PLAY_ID });
  });

  it('keeps the player when title or state are missing, with empty strings', async () => {
    mountPlayer({ timeline: { info: { playheadPositionMs: 5000 } } });
    expect(await ask('playback')).toEqual({ videoId: PLAY_ID, timeMs: 5000, title: '', subtitle: '', state: '' });
  });

  it('never touches <video>.currentTime', async () => {
    const player = makePlayer();
    document.body.innerHTML = '<disney-web-player><video class="hive-video"></video></disney-web-player>';
    const video = document.querySelector('video')!;
    const read = vi.fn(() => 70);
    Object.defineProperty(video, 'currentTime', { configurable: true, get: read, set: read });
    (document.querySelector('disney-web-player') as unknown as { mediaPlayer: unknown }).mediaPlayer = player;

    expect(((await ask('playback')) as { timeMs: number }).timeMs).toBe(49_000);
    await ask('seek', 600_000);
    expect(read).not.toHaveBeenCalled();
  });

  it('is null while the stream has not loaded (NOTREADY)', async () => {
    mountPlayer(makePlayer({ playbackStatus: { currentState: 'NOTREADY' } }));
    expect(await ask('playback')).toBeNull();
  });

  it('is null without a player element, without a mediaPlayer or off a watch page', async () => {
    document.body.innerHTML = '';
    expect(await ask('playback')).toBeNull();

    mountPlayer(undefined);
    expect(await ask('playback')).toBeNull();

    mountPlayer(makePlayer());
    setPageUrl('https://www.disneyplus.com/zh-hant/home');
    expect(await ask('playback')).toBeNull();
  });

  it('is null when the playhead is not a usable number', async () => {
    for (const bad of [undefined, null, 'soon', NaN, Infinity, -5]) {
      const player = makePlayer();
      (player.timeline.info as { playheadPositionMs: unknown }).playheadPositionMs = bad;
      mountPlayer(player);
      expect(await ask('playback')).toBeNull();
    }
  });

  it('is null when reading the player throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountPlayer({
      get playbackStatus(): never {
        throw new Error('player is gone');
      },
    });
    expect(await ask('playback')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scenenote]'), expect.anything());
  });
});

describe('pause and play', () => {
  it('call the player and answer true', async () => {
    const player = makePlayer();
    mountPlayer(player);
    expect(await ask('pause')).toBe(true);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(await ask('play')).toBe(true);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('wait for a promise the player hands back', async () => {
    let settled = false;
    const player = makePlayer({
      pause: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        settled = true;
      }),
    });
    mountPlayer(player);
    expect(await ask('pause')).toBe(true);
    expect(settled).toBe(true);
  });

  it('answer false when the player rejects or throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountPlayer(makePlayer({ pause: vi.fn(async () => Promise.reject(new Error('no'))) }));
    expect(await ask('pause')).toBe(false);

    mountPlayer(
      makePlayer({
        play: vi.fn(() => {
          throw new Error('no');
        }),
      }),
    );
    expect(await ask('play')).toBe(false);
  });

  it('answer false without a player or when the method does not exist', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '';
    expect(await ask('pause')).toBe(false);
    expect(await ask('play')).toBe(false);

    mountPlayer({ timeline: { info: {} } });
    expect(await ask('pause')).toBe(false);
  });
});

describe('seek', () => {
  it('seeks the player and answers true once the playhead is there', async () => {
    const player = makePlayer();
    mountPlayer(player);
    expect(await ask('seek', 600_000)).toBe(true);
    expect(player.seek).toHaveBeenCalledWith(600_000);
  });

  it('accepts a playhead within 3 s of the target and refuses one further away', async () => {
    const near = makePlayer({
      seek: vi.fn(() => {
        near.timeline.info.playheadPositionMs = 602_900;
      }),
    });
    mountPlayer(near);
    expect(await ask('seek', 600_000)).toBe(true);

    fakeClock();
    const far = makePlayer({
      seek: vi.fn(() => {
        far.timeline.info.playheadPositionMs = 603_100;
      }),
    });
    mountPlayer(far);
    const answer = ask('seek', 600_000);
    await settle();
    await vi.advanceTimersByTimeAsync(1600);
    await settle();
    expect(await answer).toBe(false);
  });

  it('answers false after 1.5 s when the player ignores the seek (first PAUSED state after load)', async () => {
    fakeClock();
    const player = makePlayer({ seek: vi.fn() });
    mountPlayer(player);

    let answered: unknown = 'pending';
    void ask('seek', 600_000).then((result) => (answered = result));
    await settle();
    await vi.advanceTimersByTimeAsync(1400);
    await settle();
    expect(answered).toBe('pending');
    await vi.advanceTimersByTimeAsync(200);
    await settle();
    expect(answered).toBe(false);
    expect(player.seek).toHaveBeenCalledTimes(1);
  });

  it('answers true when the playhead arrives late but within 1.5 s', async () => {
    fakeClock();
    const player = makePlayer({ seek: vi.fn() });
    mountPlayer(player);

    const answer = ask('seek', 600_000);
    await settle();
    await vi.advanceTimersByTimeAsync(700);
    player.timeline.info.playheadPositionMs = 600_050;
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(await answer).toBe(true);
  });

  it('succeeds on a second try after the first was ignored', async () => {
    fakeClock();
    let calls = 0;
    const player = makePlayer({
      seek: vi.fn((ms: number) => {
        if (++calls >= 2) player.timeline.info.playheadPositionMs = ms;
      }),
    });
    mountPlayer(player);

    const first = ask('seek', 600_000);
    await settle();
    await vi.advanceTimersByTimeAsync(1600);
    await settle();
    expect(await first).toBe(false);

    const second = ask('seek', 600_000);
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(await second).toBe(true);
  });

  it('answers false without calling seek while the stream is NOTREADY', async () => {
    const player = makePlayer({ playbackStatus: { currentState: 'NOTREADY' } });
    mountPlayer(player);
    expect(await ask('seek', 600_000)).toBe(false);
    expect(player.seek).not.toHaveBeenCalled();
  });

  it('answers false without a time, without a player or when seek throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const player = makePlayer();
    mountPlayer(player);
    expect(await ask('seek')).toBe(false);
    expect(player.seek).not.toHaveBeenCalled();

    document.body.innerHTML = '';
    expect(await ask('seek', 1000)).toBe(false);

    mountPlayer(
      makePlayer({
        seek: vi.fn(() => {
          throw new Error('no');
        }),
      }),
    );
    expect(await ask('seek', 1000)).toBe(false);
  });

  it('does not let a rejected seek promise escape as an unhandled rejection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const player = makePlayer({
        seek: vi.fn((ms: number) => {
          player.timeline.info.playheadPositionMs = ms;
          return Promise.reject(new Error('seek failed'));
        }),
      });
      mountPlayer(player);
      expect(await ask('seek', 600_000)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('trickplay and frame', () => {
  it('have nothing to give on Disney+', async () => {
    mountPlayer(makePlayer());
    expect(await ask('trickplay', 1000)).toBeNull();
    expect(await ask('frame')).toBeNull();
  });
});

describe('installPageBridge', () => {
  it('is installed only once per window', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    installPageBridge(window);
    installPageBridge(window);
    expect(add).not.toHaveBeenCalledWith('message', expect.anything());

    const player = makePlayer();
    mountPlayer(player);
    const responses: unknown[] = [];
    const collect = (event: MessageEvent) => {
      if ((event.data as { source?: string } | null)?.source === 'scenenote-res') responses.push(event.data);
    };
    window.addEventListener('message', collect);
    await ask('pause');
    window.removeEventListener('message', collect);
    expect(responses).toHaveLength(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
  });
});
