/**
 * Messages between the isolated-world content script (caller) and the main-world page bridge,
 * both carried by `window.postMessage`. Every message is a plain object tagged with a fixed
 * `source`; receivers ignore anything that does not match the exact shape.
 */

export const REQUEST_SOURCE = 'scenenote-req';
export const RESPONSE_SOURCE = 'scenenote-res';

export type BridgeOp = 'playback' | 'pause' | 'play' | 'seek' | 'trickplay';

const BRIDGE_OPS: readonly string[] = ['playback', 'pause', 'play', 'seek', 'trickplay'];

export interface BridgeRequest {
  source: typeof REQUEST_SOURCE;
  id: string;
  op: BridgeOp;
  timeMs?: number;
}

export interface BridgeResponse {
  source: typeof RESPONSE_SOURCE;
  id: string;
  result: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isBridgeRequest(data: unknown): data is BridgeRequest {
  return (
    isRecord(data) &&
    data['source'] === REQUEST_SOURCE &&
    typeof data['id'] === 'string' &&
    data['id'] !== '' &&
    typeof data['op'] === 'string' &&
    BRIDGE_OPS.includes(data['op']) &&
    (data['timeMs'] === undefined ||
      (typeof data['timeMs'] === 'number' && Number.isFinite(data['timeMs'])))
  );
}

export function isBridgeResponse(data: unknown): data is BridgeResponse {
  return (
    isRecord(data) &&
    data['source'] === RESPONSE_SOURCE &&
    typeof data['id'] === 'string' &&
    data['id'] !== ''
  );
}

/** `postMessage` target for messages a window sends to itself; `*` only for opaque origins. */
export function selfOrigin(win: Window): string {
  const origin = win.location.origin;
  return origin && origin !== 'null' ? origin : '*';
}

const warned = new Set<string>();

/** Logs an unexpected failure to the console, once per `key` (keeps a broken page from flooding it). */
export function warnOnce(key: string, error: unknown): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[scenenote] ${key} failed`, error);
}

/**
 * Asks the page bridge to do `op` and resolves with its answer, or `null` when nothing
 * answers within `timeoutMs` (bridge not installed, page script busy) or the answer is empty.
 * Never rejects.
 */
export function callBridge<T>(
  op: BridgeOp,
  timeMs?: number,
  timeoutMs = 1000,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let id = '';
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!isBridgeResponse(data) || data.id !== id) return;
      finish((data.result ?? null) as T | null);
    };
    const finish = (value: T | null) => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(value);
    };

    try {
      id = crypto.randomUUID();
      const request: BridgeRequest = {
        source: REQUEST_SOURCE,
        id,
        op,
        ...(timeMs === undefined ? {} : { timeMs }),
      };
      window.addEventListener('message', onMessage);
      timer = setTimeout(() => finish(null), timeoutMs);
      window.postMessage(request, selfOrigin(window));
    } catch (error) {
      warnOnce('bridge request', error);
      finish(null);
    }
  });
}
