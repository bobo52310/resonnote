import { Window } from 'happy-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESPONSE_SOURCE, callBridge } from '../../../src/platforms/bridge-protocol';
import { installPageBridge } from '../../../src/platforms/youtube/page-bridge';

const ID = 'arj7oStGLkU';
const SHORTS_ID = 'a-b_c1D2e3F';
const WATCH_URL = `https://www.youtube.com/watch?v=${ID}`;

interface FakePlayerApi {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  getPlayerState: () => number;
  getVideoData: () => unknown;
}

function makeApi(overrides: Partial<FakePlayerApi> = {}): FakePlayerApi {
  return {
    getCurrentTime: () => 83.4567,
    seekTo: vi.fn(),
    pauseVideo: vi.fn(),
    playVideo: vi.fn(),
    getPlayerState: () => 1,
    getVideoData: () => ({
      video_id: ID,
      title: 'Inside the Mind of a Master Procrastinator | Tim Urban | TED',
      author: 'TED',
      isLive: false,
    }),
    ...overrides,
  };
}

/** A player element the way YouTube builds it: a plain element that carries the player methods. */
function addPlayer(id: 'movie_player' | 'shorts-player', api: Partial<FakePlayerApi> | null, className = '') {
  const el = document.createElement('div');
  el.id = id;
  el.className = className;
  if (api !== null) Object.assign(el, api);
  document.body.appendChild(el);
  return el;
}

function addVideo(player: Element, props: { videoWidth?: number; videoHeight?: number; readyState?: number } = {}) {
  const video = document.createElement('video');
  video.className = 'video-stream html5-main-video';
  for (const [key, value] of Object.entries({ videoWidth: 1920, videoHeight: 1080, readyState: 4, ...props })) {
    Object.defineProperty(video, key, { configurable: true, value });
  }
  player.appendChild(video);
  return video;
}

function setPageUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
}

beforeEach(() => {
  setPageUrl(WATCH_URL);
  document.body.innerHTML = '';
});

afterEach(() => {
  setPageUrl('http://localhost:3000/');
  vi.restoreAllMocks();
});

// Must stay first: the shared happy-dom window has no page bridge until the next describe installs one.
describe('callBridge without a page bridge', () => {
  it('resolves null after the timeout', async () => {
    expect(await callBridge('playback', undefined, 40)).toBeNull();
  });
});

describe('page bridge: playback', () => {
  beforeAll(() => installPageBridge(window));

  it('answers the video id, whole milliseconds, the title and that no ad is playing', async () => {
    addPlayer('movie_player', makeApi());
    expect(await callBridge('playback')).toEqual({
      videoId: ID,
      timeMs: 83457,
      title: 'Inside the Mind of a Master Procrastinator | Tim Urban | TED',
      ad: false,
    });
  });

  it('says so while an ad plays', async () => {
    addPlayer('movie_player', makeApi(), 'html5-video-player ad-showing');
    expect((await callBridge<{ ad: boolean }>('playback'))?.ad).toBe(true);
  });

  it("takes the player's video id when it differs from the URL (the URL changes first)", async () => {
    setPageUrl('https://www.youtube.com/watch?v=OLDOLDOLD00');
    addPlayer('movie_player', makeApi());
    expect((await callBridge<{ videoId: string }>('playback'))?.videoId).toBe(ID);
  });

  it('uses the URL id when the player has none, and answers null when neither has one', async () => {
    addPlayer('movie_player', makeApi({ getVideoData: () => ({ video_id: '', title: 'T' }) }));
    expect(await callBridge('playback')).toEqual({ videoId: ID, timeMs: 83457, title: 'T', ad: false });

    document.body.innerHTML = '';
    setPageUrl('https://www.youtube.com/');
    addPlayer('movie_player', makeApi({ getVideoData: () => ({}) }));
    expect(await callBridge('playback')).toBeNull();
  });

  it('answers an empty title when the player has none', async () => {
    addPlayer('movie_player', makeApi({ getVideoData: () => ({ video_id: ID }) }));
    expect((await callBridge<{ title: string }>('playback'))?.title).toBe('');
  });

  it('reads #shorts-player on a Shorts page and ignores the idle #movie_player', async () => {
    setPageUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    addPlayer('movie_player', makeApi({ getCurrentTime: () => 0, getVideoData: () => ({ video_id: 'IDLEIDLEIDL' }) }));
    addPlayer(
      'shorts-player',
      makeApi({ getCurrentTime: () => 4.5, getVideoData: () => ({ video_id: SHORTS_ID, title: 'A short' }) }),
    );
    expect(await callBridge('playback')).toEqual({ videoId: SHORTS_ID, timeMs: 4500, title: 'A short', ad: false });
  });

  it('reads #movie_player on a normal page even when a #shorts-player is around', async () => {
    addPlayer('shorts-player', makeApi({ getCurrentTime: () => 1 }));
    addPlayer('movie_player', makeApi({ getCurrentTime: () => 2 }));
    expect((await callBridge<{ timeMs: number }>('playback'))?.timeMs).toBe(2000);
  });

  it('answers null without a player, with a bad time or when the methods are missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await callBridge('playback')).toBeNull();

    addPlayer('movie_player', makeApi({ getCurrentTime: () => Number.NaN }));
    expect(await callBridge('playback')).toBeNull();

    document.body.innerHTML = '';
    addPlayer('movie_player', null);
    expect(await callBridge('playback')).toBeNull();
  });

  it('answers null instead of failing when the player throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    addPlayer(
      'movie_player',
      makeApi({
        getCurrentTime: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(await callBridge('playback')).toBeNull();
  });
});

describe('page bridge: pause, play, seek', () => {
  beforeAll(() => installPageBridge(window));

  it('passes pause and play to the player', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    expect(await callBridge('pause')).toBe(true);
    expect(await callBridge('play')).toBe(true);
    expect(api.pauseVideo).toHaveBeenCalledTimes(1);
    expect(api.playVideo).toHaveBeenCalledTimes(1);
  });

  it('seeks in seconds, allowing the seek to leave the buffered range', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    expect(await callBridge('seek', 600500)).toBe(true);
    expect(api.seekTo).toHaveBeenCalledWith(600.5, true);
  });

  it('seeks to the start', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    expect(await callBridge('seek', 0)).toBe(true);
    expect(api.seekTo).toHaveBeenCalledWith(0, true);
  });

  it('refuses to seek without a finite time', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    expect(await callBridge('seek')).toBe(false);
    expect(api.seekTo).not.toHaveBeenCalled();
  });

  it('controls the Shorts player on a Shorts page', async () => {
    setPageUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    const idle = makeApi();
    const shorts = makeApi();
    addPlayer('movie_player', idle);
    addPlayer('shorts-player', shorts);
    expect(await callBridge('pause')).toBe(true);
    expect(shorts.pauseVideo).toHaveBeenCalledTimes(1);
    expect(idle.pauseVideo).not.toHaveBeenCalled();
  });

  it('answers false without a player or when a method is missing or throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await callBridge('pause')).toBe(false);
    expect(await callBridge('seek', 1000)).toBe(false);

    addPlayer('movie_player', null);
    expect(await callBridge('play')).toBe(false);
    expect(await callBridge('seek', 1000)).toBe(false);

    document.body.innerHTML = '';
    addPlayer(
      'movie_player',
      makeApi({
        pauseVideo: () => {
          throw new Error('boom');
        },
      }),
    );
    expect(await callBridge('pause')).toBe(false);
  });
});

describe('page bridge: frame', () => {
  beforeAll(() => installPageBridge(window));

  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  /** Stands in for the canvas, which happy-dom cannot draw on. */
  function stubCanvas(blob: Blob | null) {
    const drawImage = vi.fn();
    const seen: { width: number; height: number; type?: string; quality?: unknown } = { width: 0, height: 0 };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      seen.width = this.width;
      seen.height = this.height;
      return { drawImage } as unknown as CanvasRenderingContext2D;
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(((
      callback: BlobCallback,
      type?: string,
      quality?: unknown,
    ) => {
      seen.type = type;
      seen.quality = quality;
      callback(blob);
    }) as never);
    return { drawImage, seen };
  }

  it('draws the video at its own size and answers the JPEG bytes (quality 0.9)', async () => {
    const player = addPlayer('movie_player', makeApi());
    const video = addVideo(player);
    const { drawImage, seen } = stubCanvas(new Blob([JPEG], { type: 'image/jpeg' }));

    const result = await callBridge<Uint8Array>('frame');
    expect(Array.from(result ?? [])).toEqual(Array.from(JPEG));
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1920, 1080);
    expect(seen).toMatchObject({ width: 1920, height: 1080, type: 'image/jpeg', quality: 0.9 });
  });

  it('takes the picture of the Shorts player on a Shorts page', async () => {
    setPageUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    const idlePlayer = addPlayer('movie_player', makeApi());
    addVideo(idlePlayer, { videoWidth: 0, videoHeight: 0 });
    const shortsPlayer = addPlayer('shorts-player', makeApi());
    const shortsVideo = addVideo(shortsPlayer, { videoWidth: 1080, videoHeight: 1920 });
    const { drawImage } = stubCanvas(new Blob([JPEG]));

    expect(await callBridge('frame')).not.toBeNull();
    expect(drawImage).toHaveBeenCalledWith(shortsVideo, 0, 0, 1080, 1920);
  });

  it('answers null without a player or a video', async () => {
    const { drawImage } = stubCanvas(new Blob([JPEG]));
    expect(await callBridge('frame')).toBeNull();
    addPlayer('movie_player', makeApi());
    expect(await callBridge('frame')).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('answers null while the video has no size or no picture data yet', async () => {
    const player = addPlayer('movie_player', makeApi());
    const video = addVideo(player, { videoWidth: 0, videoHeight: 0 });
    const { drawImage } = stubCanvas(new Blob([JPEG]));
    expect(await callBridge('frame')).toBeNull();

    video.remove();
    addVideo(player, { readyState: 1 });
    expect(await callBridge('frame')).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('answers null when the canvas gives no blob or something that is not a JPEG', async () => {
    addVideo(addPlayer('movie_player', makeApi()));
    stubCanvas(null);
    expect(await callBridge('frame')).toBeNull();

    vi.restoreAllMocks();
    stubCanvas(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], { type: 'image/png' }));
    expect(await callBridge('frame')).toBeNull();
  });

  it('answers null instead of failing when the canvas is tainted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    addVideo(addPlayer('movie_player', makeApi()));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ drawImage: vi.fn() })) as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((() => {
      throw new Error('SecurityError');
    }) as never);
    expect(await callBridge('frame')).toBeNull();
  });

  it('answers null when there is no 2d context', async () => {
    addVideo(addPlayer('movie_player', makeApi()));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
    expect(await callBridge('frame')).toBeNull();
  });
});

describe('page bridge: other ops and installation', () => {
  beforeAll(() => installPageBridge(window));

  it('has no scrubber preview (the frame op is the better picture)', async () => {
    addPlayer('movie_player', makeApi());
    expect(await callBridge('trickplay', 1000)).toBeNull();
  });

  it('answers each request once even if installed twice', async () => {
    addPlayer('movie_player', makeApi());
    installPageBridge(window);
    installPageBridge(window);

    const responses: unknown[] = [];
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === 'object' && data !== null && (data as { source?: unknown }).source === RESPONSE_SOURCE) {
        responses.push(data);
      }
    };
    window.addEventListener('message', onMessage);
    try {
      await callBridge('pause');
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      window.removeEventListener('message', onMessage);
    }
    expect(responses).toHaveLength(1);
  });

  it('ignores messages that are not bridge requests', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    window.postMessage({ source: 'someone-else', op: 'pause', id: '1' }, '*');
    window.postMessage('pause', '*');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.pauseVideo).not.toHaveBeenCalled();
  });
});

describe('page bridge: who may ask', () => {
  beforeAll(() => installPageBridge(window));

  const post = (data: unknown, source: MessageEventSource | null, origin: string) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source }));

  it('ignores requests that another window posted, and answers its own', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    const frame = new Window();
    try {
      // A frame of another origin on the page can post to this window too.
      for (const source of [frame as unknown as MessageEventSource, null]) {
        post({ source: 'scenenote-req', id: 'x', op: 'seek', timeMs: 0 }, source, 'https://evil.example');
        post({ source: 'scenenote-req', id: 'y', op: 'pause' }, source, 'https://evil.example');
        post({ source: 'scenenote-req', id: 'z', op: 'frame' }, source, 'https://evil.example');
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(api.seekTo).not.toHaveBeenCalled();
      expect(api.pauseVideo).not.toHaveBeenCalled();

      post({ source: 'scenenote-req', id: 'own', op: 'pause' }, window, window.location.origin);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(api.pauseVideo).toHaveBeenCalledTimes(1);
    } finally {
      await frame.happyDOM.close();
    }
  });

  it('still answers the content script, whose messages come from this window', async () => {
    const api = makeApi();
    addPlayer('movie_player', api);
    expect(await callBridge('pause')).toBe(true);
    expect(api.pauseVideo).toHaveBeenCalledTimes(1);
  });
});
