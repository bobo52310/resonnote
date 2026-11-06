import { jumpTo, type JumpDeps } from '../background/jump';
import { listRecent, RECENT_THUMB_WIDTH } from '../background/recent';
import { handleDelete, handleSave, handleUpdate } from '../background/save';
import { getImage, listNotes } from '../core/db';
import { downscaleJpeg } from '../export/image';
import { handleTrigger, type TriggerDeps } from '../background/trigger';
import type { JumpResult, ToBackground } from '../core/messages';
import { isPlatform } from '../platforms/registry';

const CAPTURE_COMMAND = 'capture-scene';

type SaveMessage = Extract<ToBackground, { type: 'resonnote/save' }>;
/** Messages from before the platforms existed name none: they are Netflix's. */
type WithOptionalPlatform<T extends { platform: unknown }> = Omit<T, 'platform'> &
  Partial<Pick<T, 'platform'>>;
type JumpMessage = WithOptionalPlatform<Extract<ToBackground, { type: 'resonnote/jump' }>>;
type RecentMessage = WithOptionalPlatform<Extract<ToBackground, { type: 'resonnote/recent' }>>;

/** True when `platform` is absent (= Netflix) or names a platform we know. */
function hasKnownPlatform(message: Record<string, unknown>): boolean {
  return message['platform'] === undefined || isPlatform(message['platform']);
}

function isRecentMessage(message: Record<string, unknown>): message is RecentMessage {
  return (
    message['type'] === 'resonnote/recent' &&
    hasKnownPlatform(message) &&
    typeof message['videoId'] === 'string' &&
    typeof message['limit'] === 'number' &&
    Number.isInteger(message['limit'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSaveMessage(message: Record<string, unknown>): message is SaveMessage {
  const { note, imageDataUrl } = message;
  return (
    message['type'] === 'resonnote/save' &&
    isRecord(note) &&
    typeof note['id'] === 'string' &&
    (imageDataUrl === null || typeof imageDataUrl === 'string')
  );
}

function isJumpMessage(message: Record<string, unknown>): message is JumpMessage {
  return (
    message['type'] === 'resonnote/jump' &&
    hasKnownPlatform(message) &&
    typeof message['videoId'] === 'string' &&
    typeof message['timeMs'] === 'number' &&
    Number.isFinite(message['timeMs'])
  );
}

export default defineBackground(() => {
  const triggerDeps: TriggerDeps = {
    sendToTab: (tabId, msg) => browser.tabs.sendMessage(tabId, msg),
    captureVisibleTab: (windowId) =>
      browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 }),
    openNotebook: () => browser.runtime.openOptionsPage(),
    // action.setBadgeText / setTitle need no permission of their own.
    setBadge: async (tabId, text, title) => {
      await browser.action.setBadgeText({ tabId, text });
      await browser.action.setTitle({ tabId, title });
    },
  };

  const jumpDeps: JumpDeps = {
    queryTabs: async (patterns) => {
      // The patterns may be broader than the watch pages; jumpTo checks the id.
      const tabs = await browser.tabs.query({ url: patterns });
      return tabs.flatMap((tab) =>
        tab.id === undefined ? [] : [{ id: tab.id, windowId: tab.windowId, url: tab.url }],
      );
    },
    focus: async (tabId, windowId) => {
      await browser.tabs.update(tabId, { active: true });
      await browser.windows.update(windowId, { focused: true });
    },
    sendToTab: (tabId, msg) => browser.tabs.sendMessage(tabId, msg),
    createTab: async (url) => (await browser.tabs.create({ url })).id,
    updateTabUrl: async (tabId, url) => {
      await browser.tabs.update(tabId, { url });
    },
    wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };

  const trigger = async (tab: { id?: number; windowId: number; url?: string }): Promise<void> => {
    try {
      await handleTrigger(tab, triggerDeps);
    } catch (error) {
      console.error('[resonnote] trigger failed', error);
    }
  };

  // Toolbar icon. Both this and the shortcut grant `activeTab`, which captureVisibleTab needs.
  browser.action.onClicked.addListener((tab) => {
    void trigger(tab);
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== CAPTURE_COMMAND) return;
    const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (target) await trigger(target);
  });

  // Replies are async, so use sendResponse and return true to keep the channel open.
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isRecord(message)) return;

    // The 「記下這一刻」 button on a watch page: the tab is the one that sent it.
    if (message['type'] === 'resonnote/trigger') {
      const tab = sender.tab;
      if (tab?.id === undefined) return;
      handleTrigger(tab, triggerDeps, 'button').then(
        () => sendResponse({ ok: true }),
        (error: unknown) => {
          console.error('[resonnote] trigger from the page button failed', error);
          sendResponse({ ok: false });
        },
      );
      return true;
    }

    if (message['type'] === 'resonnote/shortcut') {
      browser.commands.getAll().then(
        (commands) => sendResponse(commands.find((c) => c.name === CAPTURE_COMMAND)?.shortcut ?? ''),
        () => sendResponse(''),
      );
      return true;
    }

    if (isSaveMessage(message)) {
      void handleSave(message).then(sendResponse);
      return true;
    }

    if (isJumpMessage(message)) {
      const platform = message.platform ?? 'netflix';
      jumpTo({ platform, videoId: message.videoId, timeMs: message.timeMs }, jumpDeps).then(
        (result) => sendResponse({ ok: true, result } satisfies JumpResult),
        (error: unknown) => {
          console.error('[resonnote] could not jump back', error);
          sendResponse({ ok: false, error: String(error) } satisfies JumpResult);
        },
      );
      return true;
    }

    if (
      message['type'] === 'resonnote/update' &&
      typeof message['id'] === 'string' &&
      typeof message['subtitle'] === 'string' &&
      typeof message['body'] === 'string'
    ) {
      void handleUpdate({
        type: 'resonnote/update',
        id: message['id'],
        subtitle: message['subtitle'],
        body: message['body'],
      }).then(sendResponse);
      return true;
    }

    if (message['type'] === 'resonnote/delete' && typeof message['id'] === 'string') {
      void handleDelete({ type: 'resonnote/delete', id: message['id'] }).then(sendResponse);
      return true;
    }

    if (isRecentMessage(message)) {
      const limit = Math.min(Math.max(message.limit, 0), 5);
      void listRecent(message.platform ?? 'netflix', message.videoId, limit, {
        listNotes,
        getImage,
        shrink: (bytes) => downscaleJpeg(bytes, RECENT_THUMB_WIDTH),
      }).then(sendResponse);
      return true;
    }

    if (message['type'] === 'resonnote/open-notebook') {
      browser.runtime.openOptionsPage().then(
        () => sendResponse({ ok: true }),
        (error: unknown) => {
          console.error('[resonnote] could not open the notebook', error);
          sendResponse({ ok: false, error: String(error) });
        },
      );
      return true;
    }
  });
});
