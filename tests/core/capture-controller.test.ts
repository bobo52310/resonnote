import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createCaptureController,
  PLAYER_UI_RESTORE_MS,
  type CaptureControllerDeps,
} from '../../src/core/capture-controller';
import type { RecentNote, ToBackground } from '../../src/core/messages';
import {
  openOverlay as realOpenOverlay,
  type OverlayHandle,
  type OverlayOptions,
  type OverlayResult,
} from '../../src/core/overlay/overlay';
import type { Missing, Note, Playback, Rect } from '../../src/core/types';
import type { PlatformAdapter } from '../../src/platforms/types';

const CROPPED = 'data:image/jpeg;base64,Q1JPUA==';
const TRICKPLAY = 'data:image/jpeg;base64,VFJJQ0s=';
const SCREENSHOT = 'data:image/jpeg;base64,U0hPVA==';
const FRAME = 'data:image/jpeg;base64,RlJBTUU=';
const FRAME_BYTES = new Uint8Array([0xff, 0xd8, 9, 9]);
const RECT: Rect = { x: 0, y: 100, width: 1280, height: 720 };
const PLAYBACK: Playback = { videoId: '83053998', title: '造山者', timeMs: 1003469 };

type SaveMessage = Extract<ToBackground, { type: 'resonnote/save' }>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** An overlay whose save/cancel the test presses by hand. */
function fakeOverlay() {
  let open = true;
  let deferred = defer<OverlayResult>();
  const handle: OverlayHandle = {
    result: deferred.promise,
    showError: vi.fn(),
    reopenResult: vi.fn(() => {
      deferred = defer<OverlayResult>();
      return deferred.promise;
    }),
    close: vi.fn(() => {
      open = false;
    }),
    isOpen: () => open,
    showPrevious: vi.fn(),
  };
  return {
    handle,
    press: (result: OverlayResult) => deferred.resolve(result),
  };
}

interface Harness {
  deps: CaptureControllerDeps;
  adapter: PlatformAdapter & {
    getPlayback: Mock<PlatformAdapter['getPlayback']>;
    getSubtitleText: Mock<PlatformAdapter['getSubtitleText']>;
    pause: Mock<PlatformAdapter['pause']>;
    play: Mock<PlatformAdapter['play']>;
    getVideoRect: Mock<PlatformAdapter['getVideoRect']>;
    getTrickplayFrame: Mock<PlatformAdapter['getTrickplayFrame']>;
    hidePlayerUi: Mock<PlatformAdapter['hidePlayerUi']>;
  };
  restoreUi: Mock<() => void>;
  loadRecent: Mock<CaptureControllerDeps['loadRecent']>;
  nextFrame: Mock<() => Promise<void>>;
  overlay: ReturnType<typeof fakeOverlay>;
  openOverlay: Mock<(opts: OverlayOptions) => OverlayHandle>;
  cropAndCheck: Mock<CaptureControllerDeps['cropAndCheck']>;
  jpegBytesToDataUrl: Mock<CaptureControllerDeps['jpegBytesToDataUrl']>;
  sendToBackground: Mock<CaptureControllerDeps['sendToBackground']>;
  mountEl: Element;
  calls: string[];
}

function setup(): Harness {
  const calls: string[] = [];
  const overlay = fakeOverlay();
  const mountEl = document.createElement('div');

  const adapter = {
    getPlayback: vi.fn<PlatformAdapter['getPlayback']>(async () => ({
      playback: { ...PLAYBACK },
      missing: [],
    })),
    getSubtitleText: vi.fn<PlatformAdapter['getSubtitleText']>(() => '你好嗎'),
    pause: vi.fn<PlatformAdapter['pause']>(async () => {
      calls.push('pause');
      return true;
    }),
    play: vi.fn<PlatformAdapter['play']>(async () => {
      calls.push('play');
      return true;
    }),
    seek: vi.fn<PlatformAdapter['seek']>(async () => true),
    getVideoRect: vi.fn<PlatformAdapter['getVideoRect']>(() => ({ ...RECT })),
    getTrickplayFrame: vi.fn<PlatformAdapter['getTrickplayFrame']>(
      async () => new Uint8Array([0xff, 0xd8, 1, 2]),
    ),
    watchUrl: vi.fn<PlatformAdapter['watchUrl']>(() => 'https://example.test'),
    hidePlayerUi: vi.fn<PlatformAdapter['hidePlayerUi']>(() => {
      calls.push('hideUi');
      return restoreUi;
    }),
  };
  const restoreUi = vi.fn(() => {
    calls.push('restoreUi');
  });
  const nextFrame = vi.fn(async () => {
    calls.push('nextFrame');
  });
  const loadRecent = vi.fn<CaptureControllerDeps['loadRecent']>(async () => []);
  const openOverlay = vi.fn((_opts: OverlayOptions) => {
    calls.push('openOverlay');
    return overlay.handle;
  });
  const cropAndCheck = vi.fn<CaptureControllerDeps['cropAndCheck']>(async () => ({
    dataUrl: CROPPED,
    width: 2560,
    height: 1440,
    blocked: false,
  }));
  const jpegBytesToDataUrl = vi.fn<CaptureControllerDeps['jpegBytesToDataUrl']>(async () => ({
    dataUrl: TRICKPLAY,
    width: 320,
    height: 180,
  }));
  const sendToBackground = vi.fn<CaptureControllerDeps['sendToBackground']>(async () => ({
    ok: true as const,
  }));

  const deps: CaptureControllerDeps = {
    adapter,
    platform: 'netflix',
    cropAndCheck,
    jpegBytesToDataUrl,
    openOverlay,
    sendToBackground,
    mount: () => mountEl,
    dpr: () => 2,
    nextFrame,
    loadRecent,
    now: () => new Date('2026-10-28T10:00:00.000Z'),
    uuid: () => 'note-1',
  };
  return {
    deps,
    adapter,
    restoreUi,
    nextFrame,
    loadRecent,
    overlay,
    openOverlay,
    cropAndCheck,
    jpegBytesToDataUrl,
    sendToBackground,
    mountEl,
    calls,
  };
}

let h: Harness;

beforeEach(() => {
  h = setup();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** begin() + show() and return the options the overlay was opened with. */
async function capture(
  dataUrl: string | null = SCREENSHOT,
  controller = createCaptureController(h.deps),
) {
  expect(await controller.begin()).toEqual({ status: 'ok' });
  await controller.show(dataUrl);
  const opts = h.openOverlay.mock.calls[0]?.[0];
  if (!opts) throw new Error('overlay was not opened');
  return { controller, opts };
}

/** The recorded calls without the controls hide/restore steps (covered in their own tests). */
function videoCalls(): string[] {
  return h.calls.filter((call) => !['hideUi', 'nextFrame', 'restoreUi'].includes(call));
}

function savedMessages(): SaveMessage[] {
  return h.sendToBackground.mock.calls
    .map(([msg]) => msg)
    .filter((msg): msg is SaveMessage => msg.type === 'resonnote/save');
}

function lastNote(): Note {
  const msg = savedMessages().at(-1);
  if (!msg) throw new Error('no save message was sent');
  return msg.note;
}

describe('edits of earlier notes', () => {
  it('sends them to the background as an update', async () => {
    const { opts } = await capture();
    opts.onEditPrevious!('old', { subtitle: '台詞', body: '新心得' });
    await vi.waitFor(() =>
      expect(h.sendToBackground).toHaveBeenCalledWith({
        type: 'resonnote/update',
        id: 'old',
        subtitle: '台詞',
        body: '新心得',
      }),
    );
    expect(h.overlay.handle.showError).not.toHaveBeenCalled();
  });

  it('shows an error in the overlay when the update fails', async () => {
    const { opts } = await capture();
    h.sendToBackground.mockResolvedValueOnce({ ok: false, error: '找不到這則筆記' });
    opts.onEditPrevious!('old', { subtitle: '', body: 'x' });
    await vi.waitFor(() =>
      expect(h.overlay.handle.showError).toHaveBeenCalledWith('那一則的修改沒有存到：找不到這則筆記'),
    );
  });
});

describe('deleting earlier notes from the overlay', () => {
  const EARLIER = [{ id: 'old', timeMs: 900_000, subtitle: '早安', body: '伏筆', thumb: TRICKPLAY }];
  const OLDER = [{ id: 'older', timeMs: 60_000, subtitle: '', body: '', thumb: TRICKPLAY }];
  const showPrevious = () => h.overlay.handle.showPrevious as Mock<OverlayHandle['showPrevious']>;

  it('sends the delete to the background, then reloads the strip', async () => {
    h.loadRecent.mockResolvedValueOnce(EARLIER).mockResolvedValue(OLDER);
    const { opts } = await capture();
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenCalledWith(EARLIER));

    opts.onDeletePrevious!('old');
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenLastCalledWith(OLDER));
    expect(h.sendToBackground).toHaveBeenCalledWith({ type: 'resonnote/delete', id: 'old' });
    expect(h.loadRecent).toHaveBeenCalledTimes(2);
    expect(h.loadRecent).toHaveBeenLastCalledWith(PLAYBACK.videoId);
    expect(h.overlay.handle.showError).not.toHaveBeenCalled();
    // the reload comes after the delete was answered
    const order = [
      h.sendToBackground.mock.invocationCallOrder.at(-1)!,
      h.loadRecent.mock.invocationCallOrder.at(-1)!,
    ];
    expect(order[0]).toBeLessThan(order[1]!);
  });

  it('shows the error in the overlay when the delete fails, and still reloads the strip', async () => {
    h.loadRecent.mockResolvedValueOnce(EARLIER).mockResolvedValue(EARLIER);
    const { opts } = await capture();
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenCalledTimes(1));

    h.sendToBackground.mockResolvedValueOnce({ ok: false, error: '資料庫忙線' });
    opts.onDeletePrevious!('old');
    await vi.waitFor(() =>
      expect(h.overlay.handle.showError).toHaveBeenCalledWith('那一則沒有刪掉：資料庫忙線'),
    );
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenCalledTimes(2));
    expect(h.loadRecent).toHaveBeenCalledTimes(2);
  });

  it('treats a missing answer as a failure too', async () => {
    const { opts } = await capture();
    h.sendToBackground.mockResolvedValueOnce(undefined);
    opts.onDeletePrevious!('old');
    await vi.waitFor(() =>
      expect(h.overlay.handle.showError).toHaveBeenCalledWith('那一則沒有刪掉：背景程式沒有回應'),
    );
  });

  it('hands over an empty list too, so the strip can go away', async () => {
    h.loadRecent.mockResolvedValueOnce(EARLIER).mockResolvedValue([]);
    const { opts } = await capture();
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenCalledTimes(1));
    opts.onDeletePrevious!('old');
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenLastCalledWith([]));
  });

  it('only applies the newest reload when answers come back out of order', async () => {
    const slow = defer<RecentNote[]>();
    const quick = defer<RecentNote[]>();
    h.loadRecent
      .mockResolvedValueOnce(EARLIER)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(quick.promise);
    const { opts } = await capture();
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenCalledTimes(1));

    opts.onDeletePrevious!('first');
    await vi.waitFor(() => expect(h.loadRecent).toHaveBeenCalledTimes(2));
    opts.onDeletePrevious!('second');
    await vi.waitFor(() => expect(h.loadRecent).toHaveBeenCalledTimes(3));

    quick.resolve(OLDER);
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenLastCalledWith(OLDER));
    slow.resolve(EARLIER);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(showPrevious()).toHaveBeenCalledTimes(2);
    expect(showPrevious()).toHaveBeenLastCalledWith(OLDER);
  });

  it('only warns when a reload fails', async () => {
    h.loadRecent.mockResolvedValueOnce(EARLIER).mockRejectedValueOnce(new Error('gone'));
    const { opts } = await capture();
    await vi.waitFor(() => expect(showPrevious()).toHaveBeenCalledTimes(1));
    opts.onDeletePrevious!('old');
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(showPrevious()).toHaveBeenCalledTimes(1);
    expect(h.overlay.handle.showError).not.toHaveBeenCalled();
  });
});

describe('hint from the page button', () => {
  it('adds the use-the-shortcut-once note when the button could not take a screenshot', async () => {
    // without the hint: only the usual scrubber-image note
    const { opts } = await capture(null);
    expect(opts.missing).toEqual(['fullFrame']);
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(h.overlay.handle.close).toHaveBeenCalled());

    const h2 = setup();
    h = h2;
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(null, 'use-shortcut-once');
    expect(h.openOverlay.mock.calls[0]![0].missing).toEqual(['fullFrame', 'useShortcutOnce']);
  });

  /** Runs begin + show(null, hint) and returns the "what is missing" list the overlay got. */
  async function missingWithHint(setUp: () => void): Promise<Missing[]> {
    h = setup();
    setUp();
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(null, 'use-shortcut-once');
    return h.openOverlay.mock.calls[0]![0].missing;
  }

  it('does not add the tip when the picture is a frame drawn from the video', async () => {
    const missing = await missingWithHint(() => {
      h.adapter.grabFrame = vi.fn(async () => FRAME_BYTES);
    });
    expect(missing).toEqual([]);
  });

  it('adds the tip when there is no picture at all', async () => {
    const missing = await missingWithHint(() => {
      h.adapter.getTrickplayFrame.mockResolvedValue(null);
    });
    expect(missing).toEqual(['image', 'useShortcutOnce']);
  });

  it('adds the tip when the frame was blocked and the scrubber image was used', async () => {
    const missing = await missingWithHint(() => {
      h.adapter.grabFrame = vi.fn(async () => FRAME_BYTES);
      h.cropAndCheck.mockResolvedValue({ dataUrl: CROPPED, width: 1920, height: 1080, blocked: true });
    });
    expect(missing).toEqual(['fullFrame', 'useShortcutOnce']);
  });

  it('does not add the tip when the tab screenshot was usable', async () => {
    h = setup();
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(SCREENSHOT, 'use-shortcut-once');
    expect(h.openOverlay.mock.calls[0]![0].missing).toEqual([]);
  });

  it('reports busy while the overlay is open', async () => {
    const { controller } = await capture();
    expect(controller.isBusy()).toBe(true);
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(controller.isBusy()).toBe(false));
  });
});

describe('earlier notes behind the picture', () => {
  const EARLIER = [{ id: 'old', timeMs: 900_000, subtitle: '早安', body: '伏筆', thumb: TRICKPLAY }];

  it('asks for the earlier notes of the same video and hands them to the overlay', async () => {
    h.loadRecent.mockResolvedValue(EARLIER);
    await capture();
    expect(h.loadRecent).toHaveBeenCalledWith(PLAYBACK.videoId);
    await vi.waitFor(() => expect(h.overlay.handle.showPrevious).toHaveBeenCalledWith(EARLIER));
  });

  it('leaves the overlay alone when there are none, or when loading them fails', async () => {
    h.loadRecent.mockResolvedValueOnce([]);
    const { controller } = await capture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.overlay.handle.showPrevious).not.toHaveBeenCalled();
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(h.overlay.handle.close).toHaveBeenCalled());

    h.loadRecent.mockRejectedValueOnce(new Error('gone'));
    await controller.begin();
    await controller.show(SCREENSHOT);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.overlay.handle.showPrevious).not.toHaveBeenCalled();
  });
});

describe('player controls in the screenshot', () => {
  it('hides the controls and waits for a painted frame before begin answers', async () => {
    const controller = createCaptureController(h.deps);
    expect(await controller.begin()).toEqual({ status: 'ok' });
    expect(h.calls).toEqual(['hideUi', 'nextFrame']);
    expect(h.restoreUi).not.toHaveBeenCalled();
  });

  it('shows the controls again as soon as show arrives, before pausing', async () => {
    await capture();
    expect(h.calls.slice(0, 4)).toEqual(['hideUi', 'nextFrame', 'restoreUi', 'pause']);
    expect(h.restoreUi).toHaveBeenCalledTimes(1);
  });

  it('does not hide anything when there is no video', async () => {
    h.adapter.getPlayback.mockResolvedValue(null);
    const controller = createCaptureController(h.deps);
    expect(await controller.begin()).toEqual({ status: 'no-video' });
    expect(h.adapter.hidePlayerUi).not.toHaveBeenCalled();
  });

  it('shows the controls again after a while when show never arrives', async () => {
    vi.useFakeTimers();
    try {
      const controller = createCaptureController(h.deps);
      await controller.begin();
      vi.advanceTimersByTime(PLAYER_UI_RESTORE_MS - 1);
      expect(h.restoreUi).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(h.restoreUi).toHaveBeenCalledTimes(1);
      // A late show must not restore twice.
      await controller.show(SCREENSHOT);
      expect(h.restoreUi).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still answers ok when hiding the controls throws', async () => {
    h.adapter.hidePlayerUi.mockImplementation(() => {
      throw new Error('boom');
    });
    const controller = createCaptureController(h.deps);
    expect(await controller.begin()).toEqual({ status: 'ok' });
    await controller.show(SCREENSHOT);
    expect(h.openOverlay).toHaveBeenCalledTimes(1);
  });
});

describe('begin', () => {
  it('begin returns busy while overlay is open', async () => {
    const { controller } = await capture();
    expect(await controller.begin()).toEqual({ status: 'busy' });
    // a busy answer must not disturb the open overlay
    expect(h.overlay.handle.close).not.toHaveBeenCalled();
  });

  it('returns no-video when the adapter has no playback', async () => {
    h.adapter.getPlayback.mockResolvedValue(null);
    const controller = createCaptureController(h.deps);
    expect(await controller.begin()).toEqual({ status: 'no-video' });
    await controller.show(SCREENSHOT);
    expect(h.openOverlay).not.toHaveBeenCalled();
  });

  it('returns busy to a second begin that arrives while the first is still reading the page', async () => {
    const slow = defer<Awaited<ReturnType<PlatformAdapter['getPlayback']>>>();
    h.adapter.getPlayback.mockReturnValueOnce(slow.promise);
    const controller = createCaptureController(h.deps);
    const first = controller.begin();
    expect(await controller.begin()).toEqual({ status: 'busy' });
    slow.resolve({ playback: { ...PLAYBACK }, missing: [] });
    expect(await first).toEqual({ status: 'ok' });
  });

  it('returns busy to a begin that arrives while show is still preparing the overlay', async () => {
    const slowPause = defer<boolean>();
    h.adapter.pause.mockReturnValueOnce(slowPause.promise);
    const controller = createCaptureController(h.deps);
    await controller.begin();
    const showing = controller.show(SCREENSHOT);
    expect(await controller.begin()).toEqual({ status: 'busy' });
    slowPause.resolve(true);
    await showing;
    expect(h.openOverlay).toHaveBeenCalledTimes(1);
  });

  it('accepts a new begin once the overlay has been closed', async () => {
    const { controller } = await capture();
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(h.overlay.handle.close).toHaveBeenCalled());
    expect(await controller.begin()).toEqual({ status: 'ok' });
  });
});

describe('show: choosing the picture', () => {
  it('uses the cropped screenshot when it is not blocked', async () => {
    const { opts } = await capture();
    h.overlay.press({ action: 'save', subtitle: '你好嗎', body: '好看' });
    await vi.waitFor(() => expect(savedMessages()).toHaveLength(1));

    const msg = savedMessages()[0]!;
    expect(msg.note.image).toEqual({ source: 'tab', width: 2560, height: 1440 });
    expect(msg.imageDataUrl).toBe(CROPPED);
    expect(opts.thumbUrl).toBe(CROPPED);
    expect(opts.missing).toEqual([]);
    expect(h.cropAndCheck).toHaveBeenCalledWith(SCREENSHOT, RECT, 2);
    expect(h.adapter.getTrickplayFrame).not.toHaveBeenCalled();
  });

  it('falls back to the scrubber image when the screenshot is blocked', async () => {
    h.cropAndCheck.mockResolvedValue({ dataUrl: CROPPED, width: 2560, height: 1440, blocked: true });
    const { opts } = await capture();
    h.overlay.press({ action: 'save', subtitle: '你好嗎', body: '' });
    await vi.waitFor(() => expect(savedMessages()).toHaveLength(1));

    const msg = savedMessages()[0]!;
    expect(msg.note.image).toEqual({ source: 'trickplay', width: 320, height: 180 });
    expect(msg.imageDataUrl).toBe(TRICKPLAY);
    expect(opts.thumbUrl).toBe(TRICKPLAY);
    expect(opts.missing).toContain('fullFrame');
    expect(h.adapter.getTrickplayFrame).toHaveBeenCalledWith(PLAYBACK.timeMs);
    expect(h.jpegBytesToDataUrl).toHaveBeenCalledWith(new Uint8Array([0xff, 0xd8, 1, 2]));
  });

  it('saves without a picture when the screenshot is blocked and the scrubber image is missing', async () => {
    h.cropAndCheck.mockResolvedValue({ dataUrl: CROPPED, width: 2560, height: 1440, blocked: true });
    h.adapter.getTrickplayFrame.mockResolvedValue(null);
    const { opts } = await capture();
    h.overlay.press({ action: 'save', subtitle: '', body: 'x' });
    await vi.waitFor(() => expect(savedMessages()).toHaveLength(1));

    const msg = savedMessages()[0]!;
    expect(msg.note.image).toEqual({ source: 'none', width: 0, height: 0 });
    expect(msg.imageDataUrl).toBeNull();
    expect(opts.thumbUrl).toBeNull();
    expect(opts.missing).toContain('image');
    expect(h.jpegBytesToDataUrl).not.toHaveBeenCalled();
  });

  it('takes the blocked route when the background could not take a screenshot (dataUrl is null)', async () => {
    const { opts } = await capture(null);
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(savedMessages()).toHaveLength(1));

    expect(h.cropAndCheck).not.toHaveBeenCalled();
    expect(savedMessages()[0]!.note.image.source).toBe('trickplay');
    expect(opts.missing).toContain('fullFrame');
  });

  it('takes the blocked route when the video rect is unknown', async () => {
    h.adapter.getVideoRect.mockReturnValue(null);
    await capture();
    expect(h.cropAndCheck).not.toHaveBeenCalled();
    expect(h.adapter.getTrickplayFrame).toHaveBeenCalled();
  });

  it('takes the blocked route when cropping throws', async () => {
    h.cropAndCheck.mockRejectedValue(new Error('decode failed'));
    const { opts } = await capture();
    expect(opts.missing).toContain('fullFrame');
    expect(h.adapter.getTrickplayFrame).toHaveBeenCalled();
  });

  it.each([
    ['0 wide', { dataUrl: CROPPED, width: 0, height: 1440 }],
    ['0 high', { dataUrl: CROPPED, width: 2560, height: 0 }],
    ['has no picture', { dataUrl: '', width: 2560, height: 1440 }],
  ])('takes the blocked route when the crop area is empty (%s)', async (_label, crop) => {
    h.cropAndCheck.mockResolvedValue({ ...crop, blocked: false });
    const { opts } = await capture();
    expect(opts.missing).toContain('fullFrame');
    expect(opts.thumbUrl).toBe(TRICKPLAY);
  });

  it('takes the no-picture route when the scrubber image cannot be decoded', async () => {
    h.cropAndCheck.mockResolvedValue({ dataUrl: CROPPED, width: 2560, height: 1440, blocked: true });
    h.jpegBytesToDataUrl.mockRejectedValue(new Error('bad jpeg'));
    const { opts } = await capture();
    expect(opts.thumbUrl).toBeNull();
    expect(opts.missing).toContain('image');
  });
});

describe('show: the frame drawn from the video', () => {
  /** An adapter that can draw the <video>; the frame decodes to 1920x1080, the scrubber image to 320x180. */
  function withFrame(bytes: Uint8Array | null = FRAME_BYTES) {
    const grabFrame = vi.fn<NonNullable<PlatformAdapter['grabFrame']>>(async () => bytes);
    h.adapter.grabFrame = grabFrame;
    h.jpegBytesToDataUrl.mockImplementation(async (given) =>
      given === FRAME_BYTES
        ? { dataUrl: FRAME, width: 1920, height: 1080 }
        : { dataUrl: TRICKPLAY, width: 320, height: 180 },
    );
    return grabFrame;
  }

  async function saved() {
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(savedMessages()).toHaveLength(1));
    return savedMessages()[0]!;
  }

  it('is used when the tab screenshot is not available, without marking anything missing', async () => {
    withFrame();
    const { opts } = await capture(null);
    const msg = await saved();

    expect(msg.note.image).toEqual({ source: 'frame', width: 1920, height: 1080 });
    expect(msg.imageDataUrl).toBe(FRAME);
    expect(opts.thumbUrl).toBe(FRAME);
    expect(opts.missing).toEqual([]);
    expect(h.adapter.getTrickplayFrame).not.toHaveBeenCalled();
  });

  it('is checked for a black picture as a whole image at scale 1', async () => {
    withFrame();
    await capture(null);
    expect(h.cropAndCheck).toHaveBeenCalledTimes(1);
    expect(h.cropAndCheck).toHaveBeenCalledWith(FRAME, { x: 0, y: 0, width: 1920, height: 1080 }, 1);
  });

  it('is used when the tab screenshot was cropped to a blocked (black) picture', async () => {
    withFrame();
    h.cropAndCheck.mockResolvedValueOnce({ dataUrl: CROPPED, width: 2560, height: 1440, blocked: true });
    await capture();
    expect((await saved()).note.image.source).toBe('frame');
    expect(h.cropAndCheck).toHaveBeenCalledTimes(2);
  });

  it('is not asked for when the tab screenshot is usable', async () => {
    const grabFrame = withFrame();
    await capture();
    expect((await saved()).note.image.source).toBe('tab');
    expect(grabFrame).not.toHaveBeenCalled();
  });

  it('gives way to the scrubber image when the frame is black (DRM)', async () => {
    withFrame();
    h.cropAndCheck.mockResolvedValue({ dataUrl: CROPPED, width: 1920, height: 1080, blocked: true });
    const { opts } = await capture(null);
    const msg = await saved();

    expect(msg.note.image).toEqual({ source: 'trickplay', width: 320, height: 180 });
    expect(msg.imageDataUrl).toBe(TRICKPLAY);
    expect(opts.missing).toEqual(['fullFrame']);
  });

  it('gives way to the scrubber image when the adapter has no frame', async () => {
    withFrame(null);
    await capture(null);
    expect((await saved()).note.image.source).toBe('trickplay');
    expect(h.cropAndCheck).not.toHaveBeenCalled();
  });

  it('gives way to the scrubber image when grabbing the frame throws', async () => {
    const grabFrame = withFrame();
    grabFrame.mockRejectedValue(new Error('canvas tainted'));
    await capture(null);
    expect((await saved()).note.image.source).toBe('trickplay');
  });

  it('gives way to the scrubber image when the frame cannot be decoded or checked', async () => {
    withFrame();
    h.cropAndCheck.mockRejectedValue(new Error('decode failed'));
    await capture(null);
    expect((await saved()).note.image.source).toBe('trickplay');
  });

  it('saves without a picture when the frame is black and there is no scrubber image', async () => {
    withFrame();
    h.cropAndCheck.mockResolvedValue({ dataUrl: CROPPED, width: 1920, height: 1080, blocked: true });
    h.adapter.getTrickplayFrame.mockResolvedValue(null);
    const { opts } = await capture(null);
    expect((await saved()).note.image).toEqual({ source: 'none', width: 0, height: 0 });
    expect(opts.missing).toEqual(['image']);
  });

  it('is tried when the video rect is unknown (no crop of the screenshot)', async () => {
    withFrame();
    h.adapter.getVideoRect.mockReturnValue(null);
    await capture();
    expect((await saved()).note.image.source).toBe('frame');
  });
});

describe('platform', () => {
  it.each(['netflix', 'youtube', 'disney'] as const)('writes %s into the saved note', async (platform) => {
    h.deps.platform = platform;
    await capture();
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(savedMessages()).toHaveLength(1));
    expect(lastNote().platform).toBe(platform);
  });
});

describe('show: opening the overlay', () => {
  it('pauses the video before the overlay opens', async () => {
    await capture();
    expect(videoCalls()).toEqual(['pause', 'openOverlay']);
  });

  it('passes heading, time, subtitle and mount to the overlay', async () => {
    h.adapter.getPlayback.mockResolvedValue({
      playback: { ...PLAYBACK, season: 2, episode: 3, episodeTitle: '重逢' },
      missing: [],
    });
    const { opts } = await capture();
    expect(opts.heading).toBe('造山者 第2季第3集 重逢');
    expect(opts.time).toBe('16:43');
    expect(opts.subtitle).toBe('你好嗎');
    expect(opts.mount).toBe(h.mountEl);
  });

  it('lists a missing subtitle and whatever the adapter had to guess', async () => {
    h.adapter.getSubtitleText.mockReturnValue('');
    h.adapter.getPlayback.mockResolvedValue({
      playback: { ...PLAYBACK },
      missing: ['playerApi', 'title'],
    });
    const { opts } = await capture();
    const expected: Missing[] = ['playerApi', 'title', 'subtitle'];
    expect(opts.missing).toEqual(expected);
  });

  it('ignores show when begin was not called first', async () => {
    const controller = createCaptureController(h.deps);
    await controller.show(SCREENSHOT);
    expect(h.adapter.pause).not.toHaveBeenCalled();
    expect(h.openOverlay).not.toHaveBeenCalled();
  });

  it('uses the begin state only once', async () => {
    const { controller } = await capture();
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(h.overlay.handle.close).toHaveBeenCalled());
    await controller.show(SCREENSHOT);
    expect(h.openOverlay).toHaveBeenCalledTimes(1);
  });

  it('opens the notebook from the overlay link', async () => {
    const { opts } = await capture();
    opts.onOpenNotebook();
    expect(h.sendToBackground).toHaveBeenCalledWith({ type: 'resonnote/open-notebook' });
  });

  it('does not leave the video paused behind a stuck overlay when opening it throws', async () => {
    h.openOverlay.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(SCREENSHOT);
    expect(h.adapter.play).toHaveBeenCalledTimes(1);
    expect(await controller.begin()).toEqual({ status: 'ok' });
  });
});

describe('saving', () => {
  it('sends the note with what the user typed, then closes the overlay and resumes playback', async () => {
    await capture();
    h.overlay.press({ action: 'save', subtitle: '改過的台詞', body: '這一幕很棒' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));

    expect(lastNote()).toEqual({
      id: 'note-1',
      platform: 'netflix',
      videoId: '83053998',
      title: '造山者',
      timeMs: 1003469,
      subtitle: '改過的台詞',
      body: '這一幕很棒',
      image: { source: 'tab', width: 2560, height: 1440 },
      createdAt: '2026-10-28T10:00:00.000Z',
      updatedAt: '2026-10-28T10:00:00.000Z',
    });
    expect(h.overlay.handle.close).toHaveBeenCalledTimes(1);
    expect(h.overlay.handle.showError).not.toHaveBeenCalled();
    expect(videoCalls()).toEqual(['pause', 'openOverlay', 'play']);
  });

  it('trims trailing whitespace and newlines off the typed subtitle and body, keeping the start', async () => {
    await capture();
    h.overlay.press({ action: 'save', subtitle: '  你好嗎 \n', body: '  第一行\n\n第三行 \n\n  ' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
    expect(lastNote().subtitle).toBe('  你好嗎');
    expect(lastNote().body).toBe('  第一行\n\n第三行');
  });

  it('turns a whitespace-only subtitle or body into an empty string', async () => {
    await capture();
    h.overlay.press({ action: 'save', subtitle: ' \n ', body: '\n\n' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
    expect(lastNote().subtitle).toBe('');
    expect(lastNote().body).toBe('');
  });

  it('keeps the overlay open and the video paused when saving fails, then saves on retry', async () => {
    h.sendToBackground.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    await capture();
    h.overlay.press({ action: 'save', subtitle: 'a', body: 'first try' });
    await vi.waitFor(() =>
      expect(h.overlay.handle.showError).toHaveBeenCalledWith('存檔失敗：disk full'),
    );
    expect(h.adapter.play).not.toHaveBeenCalled();
    expect(h.overlay.handle.close).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(h.overlay.handle.reopenResult).toHaveBeenCalledTimes(1));

    h.overlay.press({ action: 'save', subtitle: 'a', body: 'second try' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));

    const [first, second] = savedMessages();
    expect(savedMessages()).toHaveLength(2);
    // The same note id, so a retry cannot create a duplicate.
    expect(second!.note.id).toBe(first!.note.id);
    expect(second!.note.body).toBe('second try');
    expect(h.overlay.handle.close).toHaveBeenCalledTimes(1);
  });

  it('treats a rejected message as a failed save', async () => {
    h.sendToBackground.mockRejectedValueOnce(new Error('Extension context invalidated.'));
    await capture();
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() =>
      expect(h.overlay.handle.showError).toHaveBeenCalledWith(
        '存檔失敗：Extension context invalidated.',
      ),
    );
    expect(h.adapter.play).not.toHaveBeenCalled();
  });

  it('treats an empty reply as a failed save (nobody confirmed the write)', async () => {
    h.sendToBackground.mockResolvedValueOnce(undefined);
    await capture();
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(h.overlay.handle.showError).toHaveBeenCalledTimes(1));
    expect(h.adapter.play).not.toHaveBeenCalled();
  });

  it('can fail several times in a row', async () => {
    h.sendToBackground
      .mockResolvedValueOnce({ ok: false, error: 'one' })
      .mockResolvedValueOnce({ ok: false, error: 'two' });
    await capture();
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(h.overlay.handle.reopenResult).toHaveBeenCalledTimes(1));
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(h.overlay.handle.reopenResult).toHaveBeenCalledTimes(2));
    expect(h.overlay.handle.showError).toHaveBeenLastCalledWith('存檔失敗：two');
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
  });
});

describe('cancelling', () => {
  it('sends nothing, closes the overlay and resumes playback', async () => {
    await capture();
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
    expect(savedMessages()).toHaveLength(0);
    expect(h.overlay.handle.close).toHaveBeenCalledTimes(1);
  });

  it('cancelling after a failed save still resumes playback', async () => {
    h.sendToBackground.mockResolvedValueOnce({ ok: false, error: 'nope' });
    await capture();
    h.overlay.press({ action: 'save', subtitle: '', body: '' });
    await vi.waitFor(() => expect(h.overlay.handle.reopenResult).toHaveBeenCalledTimes(1));
    h.overlay.press({ action: 'cancel' });
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
    expect(h.overlay.handle.close).toHaveBeenCalledTimes(1);
  });
});

describe('with the real overlay', () => {
  function overlayHost(): ShadowRoot | null {
    return h.mountEl.querySelector('[data-resonnote-overlay]')?.shadowRoot ?? null;
  }

  function pressEnterInNote(text: string) {
    const note = overlayHost()?.querySelector<HTMLTextAreaElement>('[data-role="note"]');
    if (!note) throw new Error('note field not found');
    note.value = text;
    note.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }),
    );
  }

  it('saves on Enter, closes the overlay and resumes; a failed save keeps it open until it works', async () => {
    h.deps.openOverlay = realOpenOverlay;
    h.sendToBackground.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    document.body.appendChild(h.mountEl);
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(SCREENSHOT);

    expect(overlayHost()).not.toBeNull();
    expect(await controller.begin()).toEqual({ status: 'busy' });

    pressEnterInNote('first try');
    await vi.waitFor(() =>
      expect(overlayHost()?.querySelector('[data-role="error"]')?.textContent).toBe(
        '存檔失敗：disk full',
      ),
    );
    expect(overlayHost()).not.toBeNull();
    expect(h.adapter.play).not.toHaveBeenCalled();

    pressEnterInNote('second try');
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
    expect(overlayHost()).toBeNull();
    expect(savedMessages().map((m) => m.note.body)).toEqual(['first try', 'second try']);
    expect(await controller.begin()).toEqual({ status: 'ok' });
    h.mountEl.remove();
  });

  it('is not busy for ever when the page throws the overlay away', async () => {
    h.deps.openOverlay = realOpenOverlay;
    document.body.appendChild(h.mountEl);
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(SCREENSHOT);
    expect(await controller.begin()).toEqual({ status: 'busy' });

    h.mountEl.replaceChildren(); // the overlay's host disappears without a save or cancel
    expect(await controller.begin()).toEqual({ status: 'ok' });
    h.mountEl.remove();
  });

  it('cancels on Escape', async () => {
    h.deps.openOverlay = realOpenOverlay;
    document.body.appendChild(h.mountEl);
    const controller = createCaptureController(h.deps);
    await controller.begin();
    await controller.show(SCREENSHOT);
    overlayHost()
      ?.querySelector('[data-role="note"]')
      ?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, composed: true }),
      );
    await vi.waitFor(() => expect(h.adapter.play).toHaveBeenCalledTimes(1));
    expect(overlayHost()).toBeNull();
    expect(savedMessages()).toHaveLength(0);
    h.mountEl.remove();
  });
});
