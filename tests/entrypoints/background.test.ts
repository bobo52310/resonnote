import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDb, putNote } from '../../src/core/db';
import type { RecentNote } from '../../src/core/messages';
import type { Note } from '../../src/core/types';
import background from '../../src/entrypoints/background';

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (reply: unknown) => void,
) => unknown;

let onMessage: MessageListener;

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '12345678901',
    title: '片',
    timeMs: 1000,
    subtitle: '',
    body: id,
    image: { source: 'none', width: 0, height: 0 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

/** What the background answers to a message, or 'ignored' when it declines to handle it. */
function ask(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const handled = onMessage(message, {}, resolve);
    if (handled !== true) resolve('ignored');
  });
}

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  fakeBrowser.reset();
  // The fake browser has no in-memory version of these events; the message listener is the one under test.
  vi.spyOn(fakeBrowser.action.onClicked, 'addListener').mockImplementation(() => {});
  vi.spyOn(fakeBrowser.commands.onCommand, 'addListener').mockImplementation(() => {});
  vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((
    listener: MessageListener,
  ) => {
    onMessage = listener;
  }) as never);
  background.main();
});

describe('scenenote/recent', () => {
  it('treats a message without a platform as Netflix (what older content scripts send)', async () => {
    await putNote(makeNote('netflix-note'));
    await putNote(makeNote('youtube-note', { platform: 'youtube' }));
    const reply = (await ask({ type: 'scenenote/recent', videoId: '12345678901', limit: 5 })) as RecentNote[];
    expect(reply.map((n) => n.body)).toEqual(['netflix-note']);
  });

  it('answers for the platform the message names', async () => {
    await putNote(makeNote('netflix-note'));
    await putNote(makeNote('youtube-note', { platform: 'youtube' }));
    const reply = (await ask({
      type: 'scenenote/recent',
      platform: 'youtube',
      videoId: '12345678901',
      limit: 5,
    })) as RecentNote[];
    expect(reply.map((n) => n.body)).toEqual(['youtube-note']);
  });

  it.each([['hulu'], [7], [null], ['']])('ignores a message that names the platform %j', async (platform) => {
    expect(
      await ask({ type: 'scenenote/recent', platform, videoId: '12345678901', limit: 5 }),
    ).toBe('ignored');
  });
});

describe('scenenote/jump', () => {
  it.each([['hulu'], [7], [null], ['']])('ignores a message that names the platform %j', async (platform) => {
    expect(
      await ask({ type: 'scenenote/jump', platform, videoId: '12345678901', timeMs: 1000 }),
    ).toBe('ignored');
  });

  it('takes a message without a platform as Netflix and one with a platform as that platform', async () => {
    const query = vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((async () => []) as never);
    const create = vi
      .spyOn(fakeBrowser.tabs, 'create')
      .mockImplementation((async () => ({ id: 5 })) as never);

    const older = await ask({ type: 'scenenote/jump', videoId: '83053998', timeMs: 61_000 });
    expect(older).toEqual({ ok: true, result: 'new' });
    expect(query).toHaveBeenLastCalledWith({
      url: ['https://www.netflix.com/watch/*', 'https://www.netflix.com/*/watch/*'],
    });
    expect(create).toHaveBeenLastCalledWith({ url: 'https://www.netflix.com/watch/83053998?t=61' });

    const youtube = await ask({
      type: 'scenenote/jump',
      platform: 'youtube',
      videoId: 'arj7oStGLkU',
      timeMs: 61_000,
    });
    expect(youtube).toEqual({ ok: true, result: 'new' });
    expect(create).toHaveBeenLastCalledWith({
      url: 'https://www.youtube.com/watch?v=arj7oStGLkU&t=61s',
    });
  });
});
