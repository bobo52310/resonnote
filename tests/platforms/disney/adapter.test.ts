import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contentRect } from '../../../src/core/capture-math';
import { createDisneyAdapter } from '../../../src/platforms/disney/adapter';
import { askBridge } from '../../../src/platforms/bridge-protocol';
import { installPageBridge } from '../../../src/platforms/disney/page-bridge';

vi.mock('../../../src/platforms/bridge-protocol', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/platforms/bridge-protocol')>()),
  askBridge: vi.fn(),
}));

const bridge = vi.mocked(askBridge);

const ID = '4b3a1c2e-9f00-4d6b-8a21-0123456789ab';
const PLAY_URL = `https://www.disneyplus.com/zh-hant/play/${ID}`;

/** Answers each bridge op from a table; ops that are missing from the table answer null (no bridge). */
function answerBridge(answers: Partial<Record<string, unknown>>) {
  bridge.mockImplementation((async (op: string) => answers[op] ?? null) as typeof askBridge);
}

function setUrl(url: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

/** What the page bridge sends for 《尚公主》 S1E2 (measured on disneyplus.com 2026-10-29). */
const EPISODE_ANSWER = {
  videoId: ID,
  timeMs: 49_000,
  title: '尚公主',
  subtitle: '第 1 季第 2 集：第2集',
  state: 'PAUSED',
};

/** A `<video>` whose currentTime is a trap: on Disney+ it is not the programme time. */
function trapVideo(video: HTMLVideoElement): ReturnType<typeof vi.fn> {
  const touched = vi.fn(() => 70);
  Object.defineProperty(video, 'currentTime', { configurable: true, get: touched, set: touched });
  return touched;
}

function boxOf(video: Element, left: number, top: number, width: number, height: number) {
  (video as HTMLElement).getBoundingClientRect = () =>
    ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height }) as DOMRect;
}

function sizeOf(video: HTMLVideoElement, videoWidth: number, videoHeight: number) {
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: videoWidth });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: videoHeight });
}

/** The two `<video>`s the page keeps: a 0x0 decoy first, then the real one. */
function mountVideos() {
  document.body.innerHTML = `
    <disney-web-player><div class="btm-media-client"><div class="media-element-container">
      <video class="btm-media-client-element"></video>
      <video id="hivePlayer1" class="hive-video"></video>
    </div></div></disney-web-player>`;
  const [decoy, real] = Array.from(document.querySelectorAll('video')) as [HTMLVideoElement, HTMLVideoElement];
  boxOf(decoy, 0, 0, 0, 0);
  return { decoy, real };
}

/** The controls' progress bar: `progress-bar` with an open shadow root (only in the DOM while the controls show). */
function mountProgressBar(sliderHtml: string) {
  document.body.innerHTML = '<disney-web-player-ui><main-app-controls-overlay></main-app-controls-overlay></disney-web-player-ui>';
  const overlay = document.querySelector('main-app-controls-overlay')!.attachShadow({ mode: 'open' });
  overlay.innerHTML = '<progress-bar></progress-bar>';
  overlay.querySelector('progress-bar')!.attachShadow({ mode: 'open' }).innerHTML = sliderHtml;
}

const SEEKABLE_RANGE =
  '<div class="progress-bar__seekable-range" role="slider" aria-valuenow="49" aria-valuemax="2693" aria-valuetext="0:49 of 44:53"></div>';

beforeEach(() => {
  bridge.mockReset();
  answerBridge({});
  setUrl(PLAY_URL);
  document.title = '尚公主 | Disney+';
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getPlayback with the bridge', () => {
  it('reads time and title from the bridge and season/episode from its season line', async () => {
    answerBridge({ playback: EPISODE_ANSWER });

    expect(await createDisneyAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: '尚公主', timeMs: 49_000, season: 1, episode: 2 },
      missing: [],
    });
    expect(bridge).toHaveBeenCalledWith('playback');
  });

  it('keeps a real episode title', async () => {
    answerBridge({ playback: { ...EPISODE_ANSWER, subtitle: '第 1 季第 2 集：騎士與公主' } });
    expect((await createDisneyAdapter(document).getPlayback())?.playback).toEqual({
      videoId: ID,
      title: '尚公主',
      timeMs: 49_000,
      season: 1,
      episode: 2,
      episodeTitle: '騎士與公主',
    });
  });

  it('gives a movie just its title', async () => {
    answerBridge({ playback: { ...EPISODE_ANSWER, title: '內幕', subtitle: '' } });
    expect(await createDisneyAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: '內幕', timeMs: 49_000 },
      missing: [],
    });
  });

  it('uses the tab title without " | Disney+" when the bridge title is empty', async () => {
    answerBridge({ playback: { ...EPISODE_ANSWER, title: '' } });
    expect(await createDisneyAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: '尚公主', timeMs: 49_000, season: 1, episode: 2 },
      missing: ['title'],
    });
  });

  it('falls back to "Disney+ <first 8 of the id>" when the tab title says nothing either', async () => {
    answerBridge({ playback: { ...EPISODE_ANSWER, title: '  ', subtitle: '' } });
    for (const tabTitle of ['Disney+', '', ' | Disney+']) {
      document.title = tabTitle;
      expect(await createDisneyAdapter(document).getPlayback()).toEqual({
        playback: { videoId: ID, title: 'Disney+ 4b3a1c2e', timeMs: 49_000 },
        missing: ['title'],
      });
    }
  });

  it('treats a malformed bridge answer like no answer', async () => {
    for (const bad of [{ videoId: 5, timeMs: 1 }, { videoId: ID, timeMs: 'soon' }, { videoId: '', timeMs: 1 }, 'x']) {
      answerBridge({ playback: bad });
      expect(await createDisneyAdapter(document).getPlayback()).toBeNull();
    }
  });

  it('reads the page afresh on every call (single-page app)', async () => {
    const adapter = createDisneyAdapter(document);
    answerBridge({ playback: EPISODE_ANSWER });
    expect((await adapter.getPlayback())?.playback.title).toBe('尚公主');

    answerBridge({ playback: { ...EPISODE_ANSWER, videoId: 'other', title: '內幕', subtitle: '' } });
    expect((await adapter.getPlayback())?.playback).toMatchObject({ videoId: 'other', title: '內幕' });
  });

  it('is null instead of throwing when something unexpected goes wrong', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.mockRejectedValue(new Error('boom'));
    expect(await createDisneyAdapter(document).getPlayback()).toBeNull();
  });
});

describe('getPlayback without the bridge', () => {
  it('reads the programme time from the progress bar (aria-valuenow is in seconds)', async () => {
    mountProgressBar(SEEKABLE_RANGE);

    expect(await createDisneyAdapter(document).getPlayback()).toEqual({
      playback: { videoId: ID, title: '尚公主', timeMs: 49_000 },
      missing: ['playerApi', 'title'],
    });
  });

  it('rounds fractional seconds to milliseconds', async () => {
    mountProgressBar('<div class="progress-bar__seekable-range" aria-valuenow="49.0804"></div>');
    expect((await createDisneyAdapter(document).getPlayback())?.playback.timeMs).toBe(49_080);
  });

  it('accepts any slider with aria-valuenow inside the progress-bar element', async () => {
    mountProgressBar('<div class="something-else" role="slider" aria-valuenow="1200"></div>');
    expect((await createDisneyAdapter(document).getPlayback())?.playback.timeMs).toBe(1_200_000);
  });

  it('finds a slider in the progress-bar light DOM too', async () => {
    document.body.innerHTML = '<progress-bar><div role="slider" aria-valuenow="30"></div></progress-bar>';
    expect((await createDisneyAdapter(document).getPlayback())?.playback.timeMs).toBe(30_000);
  });

  it('ignores sliders that do not belong to a progress-bar (the volume slider)', async () => {
    document.body.innerHTML = '<volume-control><div role="slider" aria-valuenow="80"></div></volume-control>';
    expect(await createDisneyAdapter(document).getPlayback()).toBeNull();
  });

  it('skips a progress bar that has no usable value', async () => {
    mountProgressBar('<div role="slider" aria-valuenow=""></div><div role="slider" aria-valuenow="abc"></div>');
    expect(await createDisneyAdapter(document).getPlayback()).toBeNull();
  });

  it('uses "Disney+ <id>" as the title when the tab title says nothing', async () => {
    document.title = 'Disney+';
    mountProgressBar(SEEKABLE_RANGE);
    expect((await createDisneyAdapter(document).getPlayback())?.playback.title).toBe('Disney+ 4b3a1c2e');
  });

  it('is null when the controls are hidden and the bridge is silent', async () => {
    mountVideos();
    expect(await createDisneyAdapter(document).getPlayback()).toBeNull();
  });

  it('is null off a watch page', async () => {
    mountProgressBar(SEEKABLE_RANGE);
    setUrl('https://www.disneyplus.com/zh-hant/home');
    expect(await createDisneyAdapter(document).getPlayback()).toBeNull();
  });
});

describe('<video>.currentTime is never used', () => {
  it('is not read or written by getPlayback, whichever way it gets its answer', async () => {
    const { real } = mountVideos();
    const touched = trapVideo(real);
    const adapter = createDisneyAdapter(document);

    answerBridge({ playback: EPISODE_ANSWER });
    expect((await adapter.getPlayback())?.playback.timeMs).toBe(49_000);

    answerBridge({});
    expect(await adapter.getPlayback()).toBeNull();

    // With the controls showing the progress bar wins over the (much larger) video time.
    mountProgressBar(SEEKABLE_RANGE);
    const video = document.createElement('video');
    video.className = 'hive-video';
    document.body.append(video);
    const touchedAgain = trapVideo(video);
    expect((await adapter.getPlayback())?.playback.timeMs).toBe(49_000);

    expect(touched).not.toHaveBeenCalled();
    expect(touchedAgain).not.toHaveBeenCalled();
  });

  it('is not touched by pause, play, seek or getVideoRect either', async () => {
    const { real } = mountVideos();
    const touched = trapVideo(real);
    real.pause = vi.fn();
    real.play = vi.fn(async () => {});
    boxOf(real, 0, 0, 1000, 500);
    sizeOf(real, 1920, 1080);
    const adapter = createDisneyAdapter(document);

    expect(await adapter.pause()).toBe(false);
    expect(await adapter.play()).toBe(false);
    expect(await adapter.seek(600_000)).toBe(false);
    adapter.getVideoRect();

    expect(touched).not.toHaveBeenCalled();
    expect(real.pause).not.toHaveBeenCalled();
    expect(real.play).not.toHaveBeenCalled();
  });
});

describe('pause / play / seek', () => {
  it('go through the bridge', async () => {
    answerBridge({ pause: true, play: true, seek: true });
    const adapter = createDisneyAdapter(document);
    expect(await adapter.pause()).toBe(true);
    expect(await adapter.play()).toBe(true);
    expect(await adapter.seek(600_000)).toBe(true);
    expect(bridge).toHaveBeenCalledWith('pause');
    expect(bridge).toHaveBeenCalledWith('play');
  });

  it('wait up to 2500 ms for a seek, which the bridge verifies for 1.5 s', async () => {
    answerBridge({ seek: true });
    await createDisneyAdapter(document).seek(600_000);
    expect(bridge).toHaveBeenCalledWith('seek', 600_000, 2500);
  });

  it('are false when the bridge is silent or says no', async () => {
    const adapter = createDisneyAdapter(document);
    expect(await adapter.pause()).toBe(false);
    expect(await adapter.play()).toBe(false);
    expect(await adapter.seek(600_000)).toBe(false);

    answerBridge({ pause: false, play: 'yes', seek: 0 });
    expect(await adapter.pause()).toBe(false);
    expect(await adapter.play()).toBe(false);
    expect(await adapter.seek(600_000)).toBe(false);
  });

  it('seek refuses a time that is not a number without asking the bridge', async () => {
    answerBridge({ seek: true });
    const adapter = createDisneyAdapter(document);
    expect(await adapter.seek(Number.NaN)).toBe(false);
    expect(await adapter.seek(Number.POSITIVE_INFINITY)).toBe(false);
    expect(bridge).not.toHaveBeenCalled();
  });
});

describe('getVideoRect', () => {
  it('picks the hive-video, not the 0x0 decoy that comes first', () => {
    const { decoy, real } = mountVideos();
    sizeOf(decoy, 0, 0);
    sizeOf(real, 1920, 1080);
    boxOf(real, 10, 20, 1000, 800);

    expect(createDisneyAdapter(document).getVideoRect()).toEqual(
      contentRect({ x: 10, y: 20, width: 1000, height: 800 }, 1920, 1080),
    );
    expect(createDisneyAdapter(document).getVideoRect()).toEqual({ x: 10, y: 20 + (800 - 562.5) / 2, width: 1000, height: 562.5 });
  });

  it('prefers the hive-video when another video also has a box', () => {
    const { decoy, real } = mountVideos();
    boxOf(decoy, 0, 0, 300, 300);
    sizeOf(decoy, 640, 480);
    boxOf(real, 0, 0, 1920, 1080);
    sizeOf(real, 1920, 1080);
    expect(createDisneyAdapter(document).getVideoRect()).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('takes the first video with a box when none is the hive-video', () => {
    document.body.innerHTML = '<video id="a"></video><video id="b"></video>';
    const [a, b] = Array.from(document.querySelectorAll('video')) as [HTMLVideoElement, HTMLVideoElement];
    boxOf(a, 0, 0, 0, 0);
    boxOf(b, 5, 5, 400, 225);
    sizeOf(b, 1600, 900);
    expect(createDisneyAdapter(document).getVideoRect()).toEqual({ x: 5, y: 5, width: 400, height: 225 });
  });

  it('is null without a video, without a known video size or without a box', () => {
    const adapter = createDisneyAdapter(document);
    expect(adapter.getVideoRect()).toBeNull();

    const { real } = mountVideos();
    boxOf(real, 0, 0, 1000, 500);
    expect(adapter.getVideoRect()).toBeNull(); // videoWidth 0 until the stream is playing

    sizeOf(real, 1920, 1080);
    boxOf(real, 0, 0, 0, 0);
    expect(adapter.getVideoRect()).toBeNull();
  });
});

describe('hidePlayerUi', () => {
  function mountPlayerPage() {
    document.body.innerHTML = `
      <div id="webAppRoot">
        <disney-web-player><div class="btm-media-client"><div class="media-element-container">
          <video class="btm-media-client-element"></video>
          <video id="hivePlayer1" class="hive-video"></video>
          <div class="DxcOverlay"></div>
        </div></div></disney-web-player>
        <disney-web-player-ui>
          <timed-text-override-region></timed-text-override-region>
          <main-app-controls-overlay></main-app-controls-overlay>
          <title-overlay></title-overlay>
        </disney-web-player-ui>
      </div>`;
  }
  const opacity = (selector: string) => (document.querySelector(selector) as HTMLElement).style.opacity;

  it('hides the controls but keeps the video and the subtitle region, and shows them again', () => {
    mountPlayerPage();
    const restore = createDisneyAdapter(document).hidePlayerUi();

    expect(opacity('main-app-controls-overlay')).toBe('0');
    expect(opacity('title-overlay')).toBe('0');
    expect(opacity('.DxcOverlay')).toBe('0');
    expect(opacity('timed-text-override-region')).toBe('');
    expect(opacity('video.hive-video')).toBe('');
    expect(opacity('video.btm-media-client-element')).toBe('');
    expect(opacity('disney-web-player')).toBe('');

    restore();
    expect(opacity('main-app-controls-overlay')).toBe('');
    expect(document.querySelector('title-overlay')!.hasAttribute('style')).toBe(false);
  });

  it('works inside the fullscreen element when there is one', () => {
    mountPlayerPage();
    const outside = document.createElement('aside');
    document.body.append(outside);
    const root = document.getElementById('webAppRoot')!;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => root });
    try {
      const restore = createDisneyAdapter(document).hidePlayerUi();
      expect(opacity('main-app-controls-overlay')).toBe('0');
      expect(outside.style.opacity).toBe('');
      restore();
    } finally {
      delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
    }
  });

  it('gives back a function that does nothing when there is nothing to hide', () => {
    expect(() => createDisneyAdapter(document).hidePlayerUi()()).not.toThrow();
  });
});

describe('the rest of the adapter', () => {
  it('reads the subtitle from the region shadow root', () => {
    document.body.innerHTML = '<disney-web-player-ui><timed-text-override-region></timed-text-override-region></disney-web-player-ui>';
    document.querySelector('timed-text-override-region')!.attachShadow({ mode: 'open' }).innerHTML =
      '<span class="hive-subtitle-renderer-cue"><span class="hive-subtitle-renderer-line">三、五年前賣得還行</span></span>';
    expect(createDisneyAdapter(document).getSubtitleText()).toBe('三、五年前賣得還行');
    document.body.innerHTML = '';
    expect(createDisneyAdapter(document).getSubtitleText()).toBe('');
  });

  it('has no scrubber image and no frame grab', async () => {
    const adapter = createDisneyAdapter(document);
    expect(await adapter.getTrickplayFrame(1000)).toBeNull();
    expect(adapter.grabFrame).toBeUndefined();
    expect(bridge).not.toHaveBeenCalled();
  });

  it('builds watch links without a time', () => {
    expect(createDisneyAdapter(document).watchUrl(ID, 600_000)).toBe(`https://www.disneyplus.com/play/${ID}`);
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
      playbackStatus: { currentState: 'PAUSED' },
      timeline: { info: { playheadPositionMs: 49_000, programDurationMs: 2_693_000 } },
      mediaPlaybackCriteria: {
        metadata: { title: { text: '尚公主' }, subtitle: { text: '第 1 季第 2 集：第2集' } },
      },
      seek: vi.fn((ms: number) => {
        player.timeline.info.playheadPositionMs = ms;
      }),
      pause: vi.fn(async () => ({})),
      play: vi.fn(async () => ({})),
    };
    const { real } = mountVideos();
    trapVideo(real);
    (document.querySelector('disney-web-player') as unknown as { mediaPlayer: unknown }).mediaPlayer = player;

    const adapter = createDisneyAdapter(document);
    expect(await adapter.getPlayback()).toEqual({
      playback: { videoId: ID, title: '尚公主', timeMs: 49_000, season: 1, episode: 2 },
      missing: [],
    });
    expect(await adapter.pause()).toBe(true);
    expect(await adapter.seek(600_000)).toBe(true);
    expect(player.seek).toHaveBeenCalledWith(600_000);
    expect(await adapter.play()).toBe(true);
    expect((await adapter.getPlayback())?.playback.timeMs).toBe(600_000);

    player.playbackStatus.currentState = 'NOTREADY';
    expect(await adapter.getPlayback()).toBeNull();
  });
});
