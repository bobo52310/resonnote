import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JumpResult, ToBackground } from '../../src/core/messages';
import type { Note } from '../../src/core/types';
import { createJump } from '../../src/notebook/jump-client';

const NOTE = { videoId: '83053998', timeMs: 1_003_469 } as Note;

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Lets the promise chain behind the click finish. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createJump', () => {
  it('asks the background to take the user back to the note and stays quiet on success', async () => {
    const send = vi.fn(async (_m: ToBackground): Promise<unknown> => ({ ok: true, result: 'existing' }) satisfies JumpResult);
    const notify = vi.fn();
    createJump(send, notify)(NOTE);
    await settle();
    expect(send).toHaveBeenCalledWith({ type: 'scenenote/jump', videoId: '83053998', timeMs: 1_003_469 });
    expect(notify).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('shows a failure reported by the background in the status line', async () => {
    const send = vi.fn(async (): Promise<unknown> => ({ ok: false, error: 'Error: No tab with id: 12' }) satisfies JumpResult);
    const notify = vi.fn();
    createJump(send, notify)(NOTE);
    await settle();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('跳回失敗：Error: No tab with id: 12');
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[scenenote\]/);
  });

  it('shows a failure to reach the background as well', async () => {
    const send = vi.fn(async (): Promise<unknown> => {
      throw new Error('Extension context invalidated.');
    });
    const notify = vi.fn();
    createJump(send, notify)(NOTE);
    await settle();
    expect(notify).toHaveBeenCalledWith('跳回失敗：Extension context invalidated.');
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[scenenote\]/);
  });

  it('does not report anything for an empty reply', async () => {
    const send = vi.fn(async (): Promise<unknown> => undefined);
    const notify = vi.fn();
    createJump(send, notify)(NOTE);
    await settle();
    expect(notify).not.toHaveBeenCalled();
  });

  it('never throws out of the click handler', () => {
    const send = vi.fn((): Promise<unknown> => {
      throw new Error('sync boom');
    });
    const notify = vi.fn();
    expect(() => createJump(send, notify)(NOTE)).not.toThrow();
  });
});
