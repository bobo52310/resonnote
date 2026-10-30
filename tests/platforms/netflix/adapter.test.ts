import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentRect } from '../../../src/core/capture-math';
import { createNetflixAdapter } from '../../../src/platforms/netflix/adapter';
import { askBridge } from '../../../src/platforms/bridge-protocol';
import { installPageBridge } from '../../../src/platforms/netflix/page-bridge';

vi.mock('../../../src/platforms/bridge-protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/platforms/bridge-protocol')>()),
  askBridge: vi.fn(),
}));

const bridge = vi.mocked(askBridge);

/** Answers each bridge op from a table; ops that are missing from the table answer null (no bridge). */
function answerBridge(answers: Partial<Record<string, unknown>>) {
  bridge.mockImplementation((async (op: string) => answers[op] ?? null) as typeof askBridge);
}

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

function addVideo(props: { currentTime?: number; videoWidth?: number; videoHeight?: number } = {}) {
  document.body.innerHTML = '<div data-uia="video-canvas"><video></video></div>';
  const video = document.querySelector('video')!;
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(video, key, { configurable: true, value });
  }
  return video;
}

function boxOf(video: HTMLVideoElement, left: number, top: number, width: number, height: number) {
  video.getBoundingClientRect = () =>
    ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height }) as DOMRect;
}

beforeEach(() => {
  bridge.mockReset();
  answerBridge({});
  setUrl('https://www.netflix.com/watch/83053998?t=600');
  document.title = 'Netflix';
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getPlayback', () => {
  it('uses the bridge answer and reports nothing missing', async () => {
    addVideo({ currentTime: 1 });
    answerBridge({ playback: { videoId: '83053998', timeMs: 1003469, meta: { title: '造山者－世紀的賭注' } } });

    expect(await createNetflixAdapter(document).getPlayback()).toEqual({
      playback: { videoId: '83053998', title: '造山者－世紀的賭注', timeMs: 1003469 },
      missing: [],
    });
    expect(bridge).toHaveBeenCalledWith('playback');
  });

  it('carries season, episode and episode title for a show', async () => {
    answerBridge({
      playback: {
        videoId: '112',
        timeMs: 5000,
        meta: { title: '新手上路', season: 1, episode: 2, episodeTitle: 'B' },
      },
    });
    expect((await createNetflixAdapter(document).getPlayback())?.playback).toEqual({
      videoId: '112',
      title: '新手上路',
      timeMs: 5000,
      season: 1,
      episode: 2,
      episodeTitle: 'B',
    });
  });

  it('marks only the title as missing when the player works but gave no metadata', async () => {
    answerBridge({ playback: { videoId: '83053998', timeMs: 7000, meta: null } });

    expect(await createNetflixAdapter(document).getPlayback()).toEqual({
      playback: { videoId: '83053998', title: 'Netflix 83053998', timeMs: 7000 },
      missing: ['title'],
    });
  });

  it('falls back to the URL and <video> when the bridge is silent', async () => {
    addVideo({ currentTime: 12.5 });

    expect(await createNetflixAdapter(document).getPlayback()).toEqual({
      playback: { videoId: '83053998', title: 'Netflix 83053998', timeMs: 12500 },
      missing: ['playerApi', 'title'],
    });
  });

  it('uses the tab title in the fallback unless it is just "Netflix"', async () => {
    addVideo({ currentTime: 3 });
    document.title = '造山者－世紀的賭注';

    expect(await createNetflixAdapter(document).getPlayback()).toEqual({
      playback: { videoId: '83053998', title: '造山者－世紀的賭注', timeMs: 3000 },
      missing: ['playerApi', 'title'],
    });
  });

  it('treats a malformed bridge answer like no answer', async () => {
    addVideo({ currentTime: 2 });
    answerBridge({ playback: { videoId: 83053998, timeMs: 'soon' } });

    expect((await createNetflixAdapter(document).getPlayback())?.missing).toContain('playerApi');
  });

  it('is null when neither the bridge nor the page can say what is playing', async () => {
    const adapter = createNetflixAdapter(document);
    addVideo({ currentTime: 1 });
    setUrl('https://www.netflix.com/browse');
    expect(await adapter.getPlayback()).toBeNull();

    setUrl('https://www.netflix.com/watch/1');
    document.body.innerHTML = '';
    expect(await adapter.getPlayback()).toBeNull();
  });

  it('reads the page afresh on every call (single-page app)', async () => {
    const adapter = createNetflixAdapter(document);
    addVideo({ currentTime: 1 });
    expect((await adapter.getPlayback())?.playback.videoId).toBe('83053998');

    setUrl('https://www.netflix.com/watch/70143836?t=9');
    addVideo({ currentTime: 20 });
    expect((await adapter.getPlayback())?.playback).toMatchObject({ videoId: '70143836', timeMs: 20000 });
  });

  it('does not throw when the bridge call itself fails', async () => {
    addVideo({ currentTime: 1 });
    const actual = await vi.importActual<typeof import('../../../src/platforms/bridge-protocol')>(
      '../../../src/platforms/bridge-protocol',
    );
    // The real askBridge, with a page that refuses to take the request.
    bridge.mockImplementation(actual.askBridge);
    vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('boom');
    });
    expect((await createNetflixAdapter(document).getPlayback())?.missing).toContain('playerApi');
  });
});

describe('pause / play', () => {
  it('uses the player through the bridge when it answers', async () => {
    const video = addVideo();
    const pause = vi.fn();
    video.pause = pause;
    answerBridge({ pause: true, play: true });

    const adapter = createNetflixAdapter(document);
    expect(await adapter.pause()).toBe(true);
    expect(await adapter.play()).toBe(true);
    expect(pause).not.toHaveBeenCalled();
  });

  it('falls back to the <video> element', async () => {
    const video = addVideo();
    video.pause = vi.fn();
    video.play = vi.fn(async () => {});

    const adapter = createNetflixAdapter(document);
    expect(await adapter.pause()).toBe(true);
    expect(await adapter.play()).toBe(true);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('is false when <video>.play() is rejected or there is no video', async () => {
    const video = addVideo();
    video.play = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    const adapter = createNetflixAdapter(document);
    expect(await adapter.play()).toBe(false);

    document.body.innerHTML = '';
    expect(await adapter.pause()).toBe(false);
    expect(await adapter.play()).toBe(false);
  });
});

describe('seek', () => {
  it('seeks through the bridge', async () => {
    answerBridge({ seek: true });
    expect(await createNetflixAdapter(document).seek(600000)).toBe(true);
    expect(bridge).toHaveBeenCalledWith('seek', 600000);
  });

  it('is false without the bridge and leaves <video>.currentTime alone', async () => {
    const video = addVideo({ currentTime: 5 });
    expect(await createNetflixAdapter(document).seek(600000)).toBe(false);
    expect(video.currentTime).toBe(5);
  });
});

describe('getVideoRect', () => {
  it('applies the letterbox geometry to the <video> box', () => {
    const video = addVideo({ videoWidth: 1920, videoHeight: 1080 });
    boxOf(video, 10, 20, 1000, 800);

    expect(createNetflixAdapter(document).getVideoRect()).toEqual(
      contentRect({ x: 10, y: 20, width: 1000, height: 800 }, 1920, 1080),
    );
    expect(createNetflixAdapter(document).getVideoRect()).toEqual({ x: 10, y: 20 + (800 - 562.5) / 2, width: 1000, height: 562.5 });
  });

  it('is null without a video, without a known video size or without a box', () => {
    const adapter = createNetflixAdapter(document);
    expect(adapter.getVideoRect()).toBeNull();

    const video = addVideo({ videoWidth: 0, videoHeight: 0 });
    boxOf(video, 0, 0, 1000, 500);
    expect(adapter.getVideoRect()).toBeNull();

    const sized = addVideo({ videoWidth: 1920, videoHeight: 1080 });
    boxOf(sized, 0, 0, 0, 0);
    expect(adapter.getVideoRect()).toBeNull();
  });
});

describe('getTrickplayFrame', () => {
  it('returns the JPEG bytes from the bridge and waits longer than a normal call', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1]);
    answerBridge({ trickplay: jpeg });

    expect(await createNetflixAdapter(document).getTrickplayFrame(1003469)).toBe(jpeg);
    const [op, timeMs, timeoutMs] = bridge.mock.calls[0]!;
    expect([op, timeMs]).toEqual(['trickplay', 1003469]);
    expect(timeoutMs).toBeGreaterThan(1000);
  });

  it('is null when the bridge has nothing or something that is not bytes', async () => {
    const adapter = createNetflixAdapter(document);
    expect(await adapter.getTrickplayFrame(1000)).toBeNull();
    answerBridge({ trickplay: 'jpeg' });
    expect(await adapter.getTrickplayFrame(1000)).toBeNull();
    answerBridge({ trickplay: new Uint8Array(0) });
    expect(await adapter.getTrickplayFrame(1000)).toBeNull();
  });
});

describe('getSubtitleText / watchUrl', () => {
  it('reads the subtitle from the page', () => {
    document.body.innerHTML = '<div class="player-timedtext"><span>Hi there</span></div>';
    expect(createNetflixAdapter(document).getSubtitleText()).toBe('Hi there');
    document.body.innerHTML = '';
    expect(createNetflixAdapter(document).getSubtitleText()).toBe('');
  });

  it('builds watch links', () => {
    expect(createNetflixAdapter(document).watchUrl('83053998', 1003469)).toBe(
      'https://www.netflix.com/watch/83053998?t=1003',
    );
  });
});

describe('with the real page bridge', () => {
  it('works end to end', async () => {
    const actual = await vi.importActual<typeof import('../../../src/platforms/bridge-protocol')>(
      '../../../src/platforms/bridge-protocol',
    );
    bridge.mockImplementation(actual.askBridge);
    installPageBridge(window);

    const player = {
      getMovieId: () => 83053998,
      getCurrentTime: () => 1003469,
      seek: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      getTrickPlayFrame: () => ({ image: new Uint8Array([0xff, 0xd8, 9]) }),
    };
    (window as unknown as { netflix?: unknown }).netflix = {
      appContext: {
        state: {
          playerApp: {
            getAPI: () => ({
              videoPlayer: { getAllPlayerSessionIds: () => ['s'], getVideoPlayerBySessionId: () => player },
            }),
            getState: () => ({
              videoPlayer: { videoMetadata: { 83053998: { _metadata: { video: { type: 'movie', title: 'T', id: 83053998 } } } } },
            }),
          },
        },
      },
    };
    try {
      const adapter = createNetflixAdapter(document);
      expect(await adapter.getPlayback()).toEqual({
        playback: { videoId: '83053998', title: 'T', timeMs: 1003469 },
        missing: [],
      });
      expect(await adapter.seek(600000)).toBe(true);
      expect(player.seek).toHaveBeenCalledWith(600000);
      expect(Array.from((await adapter.getTrickplayFrame(1000)) ?? [])).toEqual([0xff, 0xd8, 9]);
    } finally {
      delete (window as unknown as { netflix?: unknown }).netflix;
    }
  });
});
