import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { closeDb, getNote, putNote } from '../../src/core/db';
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

describe('resonnote/recent', () => {
  it('treats a message without a platform as Netflix (what older content scripts send)', async () => {
    await putNote(makeNote('netflix-note'));
    await putNote(makeNote('youtube-note', { platform: 'youtube' }));
    const reply = (await ask({ type: 'resonnote/recent', videoId: '12345678901', limit: 5 })) as RecentNote[];
    expect(reply.map((n) => n.body)).toEqual(['netflix-note']);
  });

  it('answers for the platform the message names', async () => {
    await putNote(makeNote('netflix-note'));
    await putNote(makeNote('youtube-note', { platform: 'youtube' }));
    const reply = (await ask({
      type: 'resonnote/recent',
      platform: 'youtube',
      videoId: '12345678901',
      limit: 5,
    })) as RecentNote[];
    expect(reply.map((n) => n.body)).toEqual(['youtube-note']);
  });

  it.each([['hulu'], [7], [null], ['']])('ignores a message that names the platform %j', async (platform) => {
    expect(
      await ask({ type: 'resonnote/recent', platform, videoId: '12345678901', limit: 5 }),
    ).toBe('ignored');
  });
});

describe('resonnote/jump', () => {
  it.each([['hulu'], [7], [null], ['']])('ignores a message that names the platform %j', async (platform) => {
    expect(
      await ask({ type: 'resonnote/jump', platform, videoId: '12345678901', timeMs: 1000 }),
    ).toBe('ignored');
  });

  it('takes a message without a platform as Netflix and one with a platform as that platform', async () => {
    const query = vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation((async () => []) as never);
    const create = vi
      .spyOn(fakeBrowser.tabs, 'create')
      .mockImplementation((async () => ({ id: 5 })) as never);

    const older = await ask({ type: 'resonnote/jump', videoId: '83053998', timeMs: 61_000 });
    expect(older).toEqual({ ok: true, result: 'new' });
    expect(query).toHaveBeenLastCalledWith({
      url: ['https://www.netflix.com/watch/*', 'https://www.netflix.com/*/watch/*'],
    });
    expect(create).toHaveBeenLastCalledWith({ url: 'https://www.netflix.com/watch/83053998?t=61' });

    const youtube = await ask({
      type: 'resonnote/jump',
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

describe('resonnote/update', () => {
  it('stores only the fields the message carries', async () => {
    await putNote(makeNote('a', { subtitle: '舊台詞', body: '筆記本改的心得' }));
    expect(await ask({ type: 'resonnote/update', id: 'a', subtitle: '新台詞' })).toEqual({ ok: true });
    expect(await getNote('a')).toMatchObject({ subtitle: '新台詞', body: '筆記本改的心得' });
  });

  it.each([
    [{ id: 'a' }],
    [{ id: 7, body: 'x' }],
    [{ id: 'a', subtitle: 3 }],
    [{ id: 'a', subtitle: 'x', body: null }],
  ])('ignores %j', async (fields) => {
    await putNote(makeNote('a'));
    expect(await ask({ type: 'resonnote/update', ...fields })).toBe('ignored');
    expect(await getNote('a')).toEqual(makeNote('a'));
  });
});

describe('resonnote/delete', () => {
  it('deletes the note and answers ok', async () => {
    await putNote(makeNote('gone'));
    await putNote(makeNote('kept'));
    expect(await ask({ type: 'resonnote/delete', id: 'gone' })).toEqual({ ok: true });
    expect(await getNote('gone')).toBeUndefined();
    expect(await getNote('kept')).toBeDefined();
  });

  it.each([[7], [null], [undefined]])('ignores a message whose id is %j', async (id) => {
    expect(await ask({ type: 'resonnote/delete', id })).toBe('ignored');
  });
});
