import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REQUEST_SOURCE,
  RESPONSE_SOURCE,
  askBridge,
  isBridgeRequest,
  type BridgeOp,
  type BridgeRequest,
} from '../../src/platforms/bridge-protocol';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Answers every bridge request on this window with `answer(request)`, like a page bridge would. */
function installFakeBridge(answer: (request: BridgeRequest) => unknown) {
  const listener = (event: MessageEvent) => {
    if (!isBridgeRequest(event.data)) return;
    const request = event.data;
    window.postMessage({ source: RESPONSE_SOURCE, id: request.id, result: answer(request) }, '*');
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

describe('isBridgeRequest', () => {
  it.each<BridgeOp>(['playback', 'pause', 'play', 'seek', 'trickplay', 'frame'])('accepts %s', (op) => {
    expect(isBridgeRequest({ source: REQUEST_SOURCE, id: 'a', op })).toBe(true);
  });

  it('rejects an unknown op, a missing id and a bad time', () => {
    expect(isBridgeRequest({ source: REQUEST_SOURCE, id: 'a', op: 'eject' })).toBe(false);
    expect(isBridgeRequest({ source: REQUEST_SOURCE, id: '', op: 'frame' })).toBe(false);
    expect(isBridgeRequest({ source: REQUEST_SOURCE, id: 'a', op: 'seek', timeMs: Number.NaN })).toBe(false);
    expect(isBridgeRequest({ source: 'other', id: 'a', op: 'frame' })).toBe(false);
  });
});

describe('askBridge', () => {
  it('passes the op, time and timeout through and resolves with the answer', async () => {
    const seen: BridgeRequest[] = [];
    const stop = installFakeBridge((request) => {
      seen.push(request);
      return { ok: true };
    });
    try {
      expect(await askBridge('seek', 1234, 500)).toEqual({ ok: true });
      expect(await askBridge('frame')).toEqual({ ok: true });
    } finally {
      stop();
    }
    expect(seen.map((r) => [r.op, r.timeMs])).toEqual([
      ['seek', 1234],
      ['frame', undefined],
    ]);
  });

  it('resolves null when nothing answers within the timeout', async () => {
    expect(await askBridge('playback', undefined, 30)).toBeNull();
  });

  it('resolves null for an empty answer', async () => {
    const stop = installFakeBridge(() => null);
    try {
      expect(await askBridge('frame')).toBeNull();
    } finally {
      stop();
    }
  });

  it('ignores an answer that another window posted, even with the right id', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    const answer = (result: unknown, source: MessageEventSource | null) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: RESPONSE_SOURCE, id: '00000000-0000-4000-8000-000000000000', result },
          source,
        }),
      );
    const frame = new Window();
    try {
      const pending = askBridge('playback', undefined, 500);
      // A frame of another origin on the page can post to this window too.
      answer('from a frame', frame as unknown as MessageEventSource);
      answer('from nowhere', null);
      answer('from this window', window);
      expect(await pending).toBe('from this window');
    } finally {
      await frame.happyDOM.close();
    }
  });

  it('resolves null when only another window answers', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001');
    const pending = askBridge('playback', undefined, 60);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: RESPONSE_SOURCE, id: '00000000-0000-4000-8000-000000000001', result: 'forged' },
        source: null,
      }),
    );
    expect(await pending).toBeNull();
  });

  it('resolves null instead of rejecting when the page refuses the request', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await askBridge('playback')).toBeNull();
  });
});
