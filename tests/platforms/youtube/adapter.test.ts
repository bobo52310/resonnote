import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentRect } from '../../../src/core/capture-math';
import { askBridge } from '../../../src/platforms/bridge-protocol';
import { createYouTubeAdapter, findPlayer } from '../../../src/platforms/youtube/adapter';
import { installPageBridge } from '../../../src/platforms/youtube/page-bridge';

vi.mock('../../../src/platforms/bridge-protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/platforms/bridge-protocol')>()),
  askBridge: vi.fn(),
}));

const bridge = vi.mocked(askBridge);

const ID = 'arj7oStGLkU';
const SHORTS_ID = 'a-b_c1D2e3F';
const WATCH_URL = `https://www.youtube.com/watch?v=${ID}&t=60s`;
const TED_TAB_TITLE = '(107) Inside the Mind of a Master Procrastinator | Tim Urban | TED - YouTube';
const TED_TITLE = 'Inside the Mind of a Master Procrastinator | Tim Urban | TED';

/** Answers each bridge op from a table; ops that are missing from the table answer null (no bridge). */
function answerBridge(answers: Partial<Record<string, unknown>>) {
  bridge.mockImplementation((async (op: string) => answers[op] ?? null) as typeof askBridge);
}

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

interface VideoProps {
  currentTime?: number;
  videoWidth?: number;
  videoHeight?: number;
}

function makeVideo(props: VideoProps = {}) {
  const video = document.createElement('video');
  video.className = 'video-stream html5-main-video';
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(video, key, { configurable: true, writable: true, value });
  }
  return video;
}

/** `<div id="movie_player">` (or `#shorts-player`) holding a video, as on youtube.com. */
function addPlayer(id: 'movie_player' | 'shorts-player', video: HTMLVideoElement | null, className = '') {
  const player = document.createElement('div');
  player.id = id;
  player.className = className;
  if (video !== null) player.appendChild(video);
  document.body.appendChild(player);
  return player;
}

function boxOf(el: Element, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height }) as DOMRect;
}

function setFullscreenElement(el: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
}

beforeEach(() => {
  bridge.mockReset();
  answerBridge({});
  setUrl(WATCH_URL);
  document.title = 'YouTube';
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
});

describe('findPlayer', () => {
  it('is #movie_player on watch and live pages and #shorts-player on Shorts', () => {
    const movie = addPlayer('movie_player', null);
    const shorts = addPlayer('shorts-player', null);
    expect(findPlayer(document)).toBe(movie);

    setUrl(`https://www.youtube.com/live/${ID}`);
    expect(findPlayer(document)).toBe(movie);

    setUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    expect(findPlayer(document)).toBe(shorts);
  });

  it('is null when the page has no such player', () => {
    expect(findPlayer(document)).toBeNull();
    addPlayer('shorts-player', null);
    expect(findPlayer(document)).toBeNull();
  });
});

describe('getPlayback', () => {
  it('uses the bridge answer and reports nothing missing', async () => {
    addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    answerBridge({ playback: { videoId: ID, timeMs: 83457, title: TED_TITLE, ad: false } });

    expect(await createYouTubeAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: TED_TITLE, timeMs: 83457 },
      missing: [],
    });
    expect(bridge).toHaveBeenCalledWith('playback');
  });

  it('is null while the bridge says an ad plays', async () => {
    addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    answerBridge({ playback: { videoId: ID, timeMs: 5000, title: 'Ad title', ad: true } });
    expect(await createYouTubeAdapter(document).getPlayback()).toBeNull();
  });

  it('is null while the player carries the ad-showing class, bridge or no bridge', async () => {
    addPlayer('movie_player', makeVideo({ currentTime: 5 }), 'html5-video-player ad-showing');
    const adapter = createYouTubeAdapter(document);
    expect(await adapter.getPlayback()).toBeNull();

    answerBridge({ playback: { videoId: ID, timeMs: 5000, title: 'T' } });
    expect(await adapter.getPlayback()).toBeNull();
  });

  it('notes again once the ad is over', async () => {
    const player = addPlayer('movie_player', makeVideo({ currentTime: 5 }), 'ad-showing');
    const adapter = createYouTubeAdapter(document);
    expect(await adapter.getPlayback()).toBeNull();
    player.classList.remove('ad-showing');
    expect((await adapter.getPlayback())?.playback.timeMs).toBe(5000);
  });

  it('takes the cleaned tab title when the player gave none, and says so', async () => {
    document.title = TED_TAB_TITLE;
    answerBridge({ playback: { videoId: ID, timeMs: 7000, title: '' } });

    expect(await createYouTubeAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: TED_TITLE, timeMs: 7000 },
      missing: ['title'],
    });
  });

  it('uses "YouTube <id>" when neither the player nor the tab has a title', async () => {
    answerBridge({ playback: { videoId: ID, timeMs: 7000 } });
    expect(await createYouTubeAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: `YouTube ${ID}`, timeMs: 7000 },
      missing: ['title'],
    });
  });

  it('falls back to the URL, the <video> and the cleaned tab title when the bridge is silent', async () => {
    addPlayer('movie_player', makeVideo({ currentTime: 12.5 }));
    document.title = TED_TAB_TITLE;

    expect(await createYouTubeAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: TED_TITLE, timeMs: 12500 },
      missing: ['playerApi', 'title'],
    });
  });

  it.each([
    ['(107) 片名 - YouTube', '片名'],
    ['(99+) 片名 - YouTube', '片名'],
    ['片名 - YouTube', '片名'],
    ['片名', '片名'],
    ['(3) Rock - Paper - Scissors - YouTube', 'Rock - Paper - Scissors'],
    ['Why YouTube - the story', 'Why YouTube - the story'],
    ['(8) 2024 (remastered) - YouTube', '2024 (remastered)'],
    ['YouTube', `YouTube ${ID}`],
    ['(5) YouTube', `YouTube ${ID}`],
    ['', `YouTube ${ID}`],
  ])('cleans the tab title %j to %j', async (tabTitle, expected) => {
    addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    document.title = tabTitle;
    expect((await createYouTubeAdapter(document).getPlayback())?.playback.title).toBe(expected);
  });

  it('uses the video of the Shorts player in the fallback, not the idle one of #movie_player', async () => {
    setUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    addPlayer('movie_player', makeVideo({ currentTime: 0, videoWidth: 0, videoHeight: 0 }));
    addPlayer('shorts-player', makeVideo({ currentTime: 7.25, videoWidth: 1080, videoHeight: 1920 }));

    expect(await createYouTubeAdapter(document).getPlayback()).toEqual({
      playback: { videoId: SHORTS_ID, title: `YouTube ${SHORTS_ID}`, timeMs: 7250 },
      missing: ['playerApi', 'title'],
    });
  });

  it('treats a malformed bridge answer like no answer', async () => {
    addPlayer('movie_player', makeVideo({ currentTime: 2 }));
    answerBridge({ playback: { videoId: 12345, timeMs: 'soon' } });
    expect((await createYouTubeAdapter(document).getPlayback())?.missing).toContain('playerApi');

    answerBridge({ playback: { videoId: '', timeMs: 5, title: 'T' } });
    expect((await createYouTubeAdapter(document).getPlayback())?.missing).toContain('playerApi');
  });

  it('is null when neither the bridge nor the page can say what is playing', async () => {
    const adapter = createYouTubeAdapter(document);
    addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    setUrl('https://www.youtube.com/');
    expect(await adapter.getPlayback()).toBeNull();

    setUrl(WATCH_URL);
    document.body.innerHTML = '';
    expect(await adapter.getPlayback()).toBeNull();
  });

  it('reads the page afresh on every call (single-page app)', async () => {
    const adapter = createYouTubeAdapter(document);
    addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    expect((await adapter.getPlayback())?.playback).toMatchObject({ videoId: ID, timeMs: 1000 });

    setUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    document.body.innerHTML = '';
    addPlayer('movie_player', makeVideo({ currentTime: 20 }));
    expect((await adapter.getPlayback())?.playback).toMatchObject({ videoId: 'dQw4w9WgXcQ', timeMs: 20000 });
  });

  it('does not throw when the bridge call itself fails', async () => {
    addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    const actual = await vi.importActual<typeof import('../../../src/platforms/bridge-protocol')>(
      '../../../src/platforms/bridge-protocol',
    );
    // The real askBridge, with a page that refuses to take the request.
    bridge.mockImplementation(actual.askBridge);
    vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await createYouTubeAdapter(document).getPlayback())?.missing).toContain('playerApi');
  });
});

describe('pause / play', () => {
  it('uses the player through the bridge when it answers', async () => {
    const video = makeVideo();
    video.pause = vi.fn();
    addPlayer('movie_player', video);
    answerBridge({ pause: true, play: true });

    const adapter = createYouTubeAdapter(document);
    expect(await adapter.pause()).toBe(true);
    expect(await adapter.play()).toBe(true);
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('falls back to the <video> element', async () => {
    const video = makeVideo();
    video.pause = vi.fn();
    video.play = vi.fn(async () => {});
    addPlayer('movie_player', video);

    const adapter = createYouTubeAdapter(document);
    expect(await adapter.pause()).toBe(true);
    expect(await adapter.play()).toBe(true);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('operates the video of the Shorts player on a Shorts page', async () => {
    setUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    const idle = makeVideo();
    idle.pause = vi.fn();
    const active = makeVideo();
    active.pause = vi.fn();
    addPlayer('movie_player', idle);
    addPlayer('shorts-player', active);

    expect(await createYouTubeAdapter(document).pause()).toBe(true);
    expect(active.pause).toHaveBeenCalledTimes(1);
    expect(idle.pause).not.toHaveBeenCalled();
  });

  it('is false when <video>.play() is rejected or there is no video', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const video = makeVideo();
    video.play = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    addPlayer('movie_player', video);
    const adapter = createYouTubeAdapter(document);
    expect(await adapter.play()).toBe(false);

    document.body.innerHTML = '';
    expect(await adapter.pause()).toBe(false);
    expect(await adapter.play()).toBe(false);
  });
});

describe('seek', () => {
  it('seeks through the bridge', async () => {
    const video = makeVideo({ currentTime: 5 });
    addPlayer('movie_player', video);
    answerBridge({ seek: true });
    expect(await createYouTubeAdapter(document).seek(600000)).toBe(true);
    expect(bridge).toHaveBeenCalledWith('seek', 600000);
    expect(video.currentTime).toBe(5);
  });

  it('moves the <video> itself when the bridge does not answer', async () => {
    const video = makeVideo({ currentTime: 5 });
    addPlayer('movie_player', video);
    expect(await createYouTubeAdapter(document).seek(600500)).toBe(true);
    expect(video.currentTime).toBe(600.5);
  });

  it('is false without a bridge answer and without a video, or for a time that is not a number', async () => {
    const adapter = createYouTubeAdapter(document);
    expect(await adapter.seek(1000)).toBe(false);

    const video = makeVideo({ currentTime: 5 });
    addPlayer('movie_player', video);
    expect(await adapter.seek(Number.NaN)).toBe(false);
    expect(video.currentTime).toBe(5);
    expect(bridge).not.toHaveBeenCalledWith('seek', Number.NaN);
  });
});

describe('getVideoRect', () => {
  it('applies the letterbox geometry to the <video> box', () => {
    const video = makeVideo({ videoWidth: 1920, videoHeight: 1080 });
    addPlayer('movie_player', video);
    boxOf(video, 10, 20, 1000, 800);

    expect(createYouTubeAdapter(document).getVideoRect()).toEqual(
      contentRect({ x: 10, y: 20, width: 1000, height: 800 }, 1920, 1080),
    );
    expect(createYouTubeAdapter(document).getVideoRect()).toEqual({
      x: 10,
      y: 20 + (800 - 562.5) / 2,
      width: 1000,
      height: 562.5,
    });
  });

  it('picks the video of the Shorts player when #movie_player holds an idle 0×0 one', () => {
    setUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    const idle = makeVideo({ videoWidth: 0, videoHeight: 0 });
    boxOf(idle, 0, 0, 0, 0);
    addPlayer('movie_player', idle);
    const active = makeVideo({ videoWidth: 1080, videoHeight: 1920 });
    boxOf(active, 400, 0, 450, 800);
    addPlayer('shorts-player', active);

    const rect = createYouTubeAdapter(document).getVideoRect();
    expect(rect).toEqual(contentRect({ x: 400, y: 0, width: 450, height: 800 }, 1080, 1920));
    expect(rect?.width).toBeGreaterThan(0);
  });

  it('is null without a player, a video, a known video size or a box', () => {
    const adapter = createYouTubeAdapter(document);
    expect(adapter.getVideoRect()).toBeNull();

    const player = addPlayer('movie_player', null);
    expect(adapter.getVideoRect()).toBeNull();

    const unsized = makeVideo({ videoWidth: 0, videoHeight: 0 });
    boxOf(unsized, 0, 0, 1000, 500);
    player.appendChild(unsized);
    expect(adapter.getVideoRect()).toBeNull();

    unsized.remove();
    const flat = makeVideo({ videoWidth: 1920, videoHeight: 1080 });
    boxOf(flat, 0, 0, 0, 0);
    player.appendChild(flat);
    expect(adapter.getVideoRect()).toBeNull();
  });
});

describe('hidePlayerUi', () => {
  const PLAYER_HTML = `
    <video class="video-stream html5-main-video"></video>
    <div class="ytp-chrome-top"></div>
    <div class="ytp-gradient-bottom"></div>
    <div id="ytp-caption-window-container" class="ytp-caption-window-container"><div class="caption-window"></div></div>
    <div class="ytp-chrome-bottom"><div class="ytp-progress-bar"></div></div>`;

  function setup() {
    document.body.innerHTML = `
      <div id="masthead"></div>
      <div id="movie_player">${PLAYER_HTML}</div>
      <div id="secondary"></div>`;
    const q = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    return { q };
  }

  it('hides the player controls and nothing else on the page, and restores them', () => {
    const { q } = setup();
    const restore = createYouTubeAdapter(document).hidePlayerUi();

    expect(q('.ytp-chrome-top').style.opacity).toBe('0');
    expect(q('.ytp-gradient-bottom').style.opacity).toBe('0');
    expect(q('.ytp-chrome-bottom').style.opacity).toBe('0');
    // the picture and the captions stay
    expect(q('video').style.opacity).toBe('');
    expect(q('#ytp-caption-window-container').style.opacity).toBe('');
    // the page around the player is left alone
    expect(q('#masthead').style.opacity).toBe('');
    expect(q('#secondary').style.opacity).toBe('');
    expect(q('#movie_player').style.opacity).toBe('');

    restore();
    expect(q('.ytp-chrome-top').hasAttribute('style')).toBe(false);
    expect(q('.ytp-chrome-bottom').hasAttribute('style')).toBe(false);
  });

  it('keeps Language Reactor subtitles inside the player', () => {
    document.body.innerHTML = `
      <div id="movie_player">
        <video></video>
        <div class="ytp-chrome-top"></div>
        <div class="overlay"><div id="lln-main-subs"></div></div>
      </div>`;
    createYouTubeAdapter(document).hidePlayerUi();
    expect(document.querySelector<HTMLElement>('.ytp-chrome-top')!.style.opacity).toBe('0');
    expect(document.querySelector<HTMLElement>('#lln-main-subs')!.style.opacity).toBe('');
    expect(document.querySelector<HTMLElement>('.overlay')!.style.opacity).toBe('');
  });

  it('works inside the Shorts player on a Shorts page', () => {
    setUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    document.body.innerHTML = `
      <div id="movie_player"><div class="ytp-chrome-top" id="idle-chrome"></div></div>
      <div id="shorts-player"><video></video><div class="ytp-chrome-top" id="active-chrome"></div></div>`;
    createYouTubeAdapter(document).hidePlayerUi();
    expect(document.querySelector<HTMLElement>('#active-chrome')!.style.opacity).toBe('0');
    expect(document.querySelector<HTMLElement>('#idle-chrome')!.style.opacity).toBe('');
  });

  it('keeps to the player when the player itself is the fullscreen element', () => {
    const { q } = setup();
    setFullscreenElement(q('#movie_player'));
    createYouTubeAdapter(document).hidePlayerUi();
    expect(q('.ytp-chrome-top').style.opacity).toBe('0');
    expect(q('#masthead').style.opacity).toBe('');
  });

  it('keeps to the player when an element around it is fullscreen', () => {
    document.body.innerHTML = `
      <div id="app">
        <div id="masthead"></div>
        <div id="movie_player"><video></video><div class="ytp-chrome-top"></div></div>
      </div>`;
    setFullscreenElement(document.getElementById('app'));
    createYouTubeAdapter(document).hidePlayerUi();
    expect(document.querySelector<HTMLElement>('.ytp-chrome-top')!.style.opacity).toBe('0');
    expect(document.querySelector<HTMLElement>('#masthead')!.style.opacity).toBe('');
  });

  it('works in the fullscreen element when it does not contain the player', () => {
    document.body.innerHTML = `
      <div id="movie_player"><video></video><div class="ytp-chrome-top"></div></div>
      <div id="other"><video></video><div class="other-chrome"></div></div>`;
    setFullscreenElement(document.getElementById('other'));
    createYouTubeAdapter(document).hidePlayerUi();
    expect(document.querySelector<HTMLElement>('.other-chrome')!.style.opacity).toBe('0');
    expect(document.querySelector<HTMLElement>('.ytp-chrome-top')!.style.opacity).toBe('');
  });

  it('does nothing, and does not throw, without a player', () => {
    document.body.innerHTML = '<div id="masthead"></div>';
    const restore = createYouTubeAdapter(document).hidePlayerUi();
    expect(document.querySelector<HTMLElement>('#masthead')!.style.opacity).toBe('');
    expect(() => restore()).not.toThrow();
  });
});

describe('getTrickplayFrame / grabFrame', () => {
  it('has no scrubber preview and never asks the bridge for one', async () => {
    answerBridge({ trickplay: new Uint8Array([0xff, 0xd8, 1]) });
    expect(await createYouTubeAdapter(document).getTrickplayFrame(1000)).toBeNull();
    expect(bridge).not.toHaveBeenCalled();
  });

  it('returns the JPEG bytes from the bridge and waits longer than a normal call', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1]);
    answerBridge({ frame: jpeg });

    const adapter = createYouTubeAdapter(document);
    expect(await adapter.grabFrame?.()).toBe(jpeg);
    const [op, timeMs, timeoutMs] = bridge.mock.calls[0]!;
    expect([op, timeMs, timeoutMs]).toEqual(['frame', undefined, 3000]);
  });

  it('is null when the bridge has nothing or something that is not bytes', async () => {
    const adapter = createYouTubeAdapter(document);
    expect(await adapter.grabFrame?.()).toBeNull();
    answerBridge({ frame: 'jpeg' });
    expect(await adapter.grabFrame?.()).toBeNull();
    answerBridge({ frame: new Uint8Array(0) });
    expect(await adapter.grabFrame?.()).toBeNull();
  });
});

describe('getSubtitleText / watchUrl', () => {
  const caption = (text: string) =>
    `<div id="ytp-caption-window-container"><div class="caption-window"><span class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment">${text}</span></span></span></div></div>`;

  it('reads the subtitle from the player', () => {
    document.body.innerHTML = `<div id="movie_player">${caption('Hi there')}</div>`;
    expect(createYouTubeAdapter(document).getSubtitleText()).toBe('Hi there');
    document.body.innerHTML = '';
    expect(createYouTubeAdapter(document).getSubtitleText()).toBe('');
  });

  it('reads the Shorts player, not the idle one, on a Shorts page', () => {
    setUrl(`https://www.youtube.com/shorts/${SHORTS_ID}`);
    document.body.innerHTML = `
      <div id="movie_player">${caption('idle')}</div>
      <div id="shorts-player">${caption('active')}</div>`;
    expect(createYouTubeAdapter(document).getSubtitleText()).toBe('active');
  });

  it('falls back to Language Reactor from anywhere on the page', () => {
    document.body.innerHTML =
      '<div id="movie_player"></div><div id="lln-main-subs"><div class="lln-subs-text"><span class="lln-word">Hola</span></div></div>';
    expect(createYouTubeAdapter(document).getSubtitleText()).toBe('Hola');
  });

  it('reads the whole page when there is no player (captions out of the usual place)', () => {
    document.body.innerHTML = caption('loose');
    expect(createYouTubeAdapter(document).getSubtitleText()).toBe('loose');
  });

  it('builds watch links', () => {
    expect(createYouTubeAdapter(document).watchUrl(ID, 1003469)).toBe(
      `https://www.youtube.com/watch?v=${ID}&t=1003s`,
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

    const player = addPlayer('movie_player', makeVideo({ currentTime: 1 }));
    const methods = {
      getCurrentTime: () => 83.4567,
      getVideoData: () => ({ video_id: ID, title: TED_TITLE }),
      seekTo: vi.fn(),
      pauseVideo: vi.fn(),
      playVideo: vi.fn(),
    };
    Object.assign(player, methods);

    const adapter = createYouTubeAdapter(document);
    expect(await adapter.getPlayback()).toEqual({
      playback: { videoId: ID, title: TED_TITLE, timeMs: 83457 },
      missing: [],
    });
    expect(await adapter.seek(600000)).toBe(true);
    expect(methods.seekTo).toHaveBeenCalledWith(600, true);
    expect(await adapter.pause()).toBe(true);
    expect(methods.pauseVideo).toHaveBeenCalledTimes(1);
    expect(await adapter.play()).toBe(true);
    expect(methods.playVideo).toHaveBeenCalledTimes(1);

    player.classList.add('ad-showing');
    expect(await adapter.getPlayback()).toBeNull();
  });
});
