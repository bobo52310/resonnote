import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToContent } from '../../src/core/messages';
import { handleTrigger } from '../../src/background/trigger';

const WATCH_URL = 'https://www.netflix.com/watch/83053998?t=600';
const SCREENSHOT = 'data:image/jpeg;base64,U0hPVA==';

type Deps = Parameters<typeof handleTrigger>[1];

function setup(overrides: Partial<Deps> = {}) {
  const calls: string[] = [];
  const sendToTab = vi.fn<Deps['sendToTab']>(async (_tabId, msg: ToContent) => {
    calls.push(msg.type);
    return msg.type === 'scenenote/begin' ? { status: 'ok' } : undefined;
  });
  const captureVisibleTab = vi.fn<Deps['captureVisibleTab']>(async () => {
    calls.push('capture');
    return SCREENSHOT;
  });
  const openNotebook = vi.fn<Deps['openNotebook']>(async () => {});
  const deps: Deps = { sendToTab, captureVisibleTab, openNotebook, ...overrides };
  return { deps, sendToTab, captureVisibleTab, openNotebook, calls };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('handleTrigger', () => {
  it.each([
    ['a Netflix browse page', 'https://www.netflix.com/browse'],
    ['another site', 'https://example.com'],
    ['an unknown url', undefined],
    ['a lookalike host', 'https://www.netflix.com.evil.test/watch/83053998'],
  ])('opens notebook for non-watch urls (%s)', async (_label, url) => {
    const t = setup();
    const result = await handleTrigger({ id: 7, windowId: 1, url }, t.deps);
    expect(result).toBe('notebook');
    expect(t.openNotebook).toHaveBeenCalledTimes(1);
    expect(t.sendToTab).not.toHaveBeenCalled();
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
  });

  it('opens the notebook when the tab has no id', async () => {
    const t = setup();
    expect(await handleTrigger({ windowId: 1, url: WATCH_URL }, t.deps)).toBe('notebook');
    expect(t.openNotebook).toHaveBeenCalledTimes(1);
    expect(t.sendToTab).not.toHaveBeenCalled();
  });

  it('trigger skips capture when busy', async () => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce({ status: 'busy' });
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('busy');
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
    expect(t.openNotebook).not.toHaveBeenCalled();
  });

  it('stops when the page has no video', async () => {
    const t = setup();
    t.sendToTab.mockResolvedValueOnce({ status: 'no-video' });
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
    expect(t.sendToTab).toHaveBeenCalledTimes(1);
  });

  it('stops when the content script cannot be reached (page opened before the extension loaded)', async () => {
    const t = setup();
    t.sendToTab.mockRejectedValueOnce(new Error('Could not establish connection.'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
    expect(t.captureVisibleTab).not.toHaveBeenCalled();
  });

  it.each([[undefined], [null], ['ok'], [{ status: 'weird' }]])(
    'stops on an unrecognised begin answer (%j)',
    async (answer) => {
      const t = setup();
      t.sendToTab.mockResolvedValueOnce(answer);
      expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
      expect(t.captureVisibleTab).not.toHaveBeenCalled();
    },
  );

  it('begins first, then captures, then shows the screenshot', async () => {
    const t = setup();
    const result = await handleTrigger({ id: 7, windowId: 3, url: WATCH_URL }, t.deps);
    expect(result).toBe('shown');
    expect(t.calls).toEqual(['scenenote/begin', 'capture', 'scenenote/show']);
    expect(t.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(t.sendToTab).toHaveBeenNthCalledWith(1, 7, { type: 'scenenote/begin' });
    expect(t.sendToTab).toHaveBeenNthCalledWith(2, 7, {
      type: 'scenenote/show',
      dataUrl: SCREENSHOT,
    });
    expect(t.openNotebook).not.toHaveBeenCalled();
  });

  it('still shows the overlay, with dataUrl null, when the screenshot fails', async () => {
    const t = setup();
    t.captureVisibleTab.mockRejectedValueOnce(new Error('Cannot access contents of the page'));
    const result = await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps);
    expect(result).toBe('shown');
    expect(t.sendToTab).toHaveBeenLastCalledWith(7, { type: 'scenenote/show', dataUrl: null });
  });

  it('sends null when the screenshot is not a non-empty string', async () => {
    const t = setup();
    t.captureVisibleTab.mockResolvedValueOnce('');
    await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps);
    expect(t.sendToTab).toHaveBeenLastCalledWith(7, { type: 'scenenote/show', dataUrl: null });
  });

  it('does not throw when the show message cannot be delivered', async () => {
    const t = setup();
    t.sendToTab
      .mockResolvedValueOnce({ status: 'ok' })
      .mockRejectedValueOnce(new Error('The message port closed'));
    expect(await handleTrigger({ id: 7, windowId: 1, url: WATCH_URL }, t.deps)).toBe('no-video');
  });
});
