import { jumpTo, type JumpDeps } from '../background/jump';
import { listRecent, RECENT_THUMB_WIDTH } from '../background/recent';
import { handleSave } from '../background/save';
import { getImage, listNotes } from '../core/db';
import { downscaleJpeg } from '../export/image';
import { handleTrigger, type TriggerDeps } from '../background/trigger';
import type { JumpResult, ToBackground } from '../core/messages';

const CAPTURE_COMMAND = 'capture-scene';

type SaveMessage = Extract<ToBackground, { type: 'scenenote/save' }>;
type JumpMessage = Extract<ToBackground, { type: 'scenenote/jump' }>;
type RecentMessage = Extract<ToBackground, { type: 'scenenote/recent' }>;

function isRecentMessage(message: Record<string, unknown>): message is RecentMessage {
  return (
    message['type'] === 'scenenote/recent' &&
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
    message['type'] === 'scenenote/save' &&
    isRecord(note) &&
    typeof note['id'] === 'string' &&
    (imageDataUrl === null || typeof imageDataUrl === 'string')
  );
}

function isJumpMessage(message: Record<string, unknown>): message is JumpMessage {
  return (
    message['type'] === 'scenenote/jump' &&
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
    queryNetflixTabs: async () => {
      // The second pattern covers locale-prefixed watch pages (/tw/watch/…); jumpTo checks the id.
      const tabs = await browser.tabs.query({
        url: ['https://www.netflix.com/watch/*', 'https://www.netflix.com/*/watch/*'],
      });
      return tabs.flatMap((tab) =>
        tab.id === undefined ? [] : [{ id: tab.id, windowId: tab.windowId, url: tab.url }],
      );
    },
    focus: async (tabId, windowId) => {
      await browser.tabs.update(tabId, { active: true });
      await browser.windows.update(windowId, { focused: true });
    },
    sendToTab: (tabId, msg) => browser.tabs.sendMessage(tabId, msg),
    createTab: async (url) => {
      await browser.tabs.create({ url });
    },
    updateTabUrl: async (tabId, url) => {
      await browser.tabs.update(tabId, { url });
    },
  };

  const trigger = async (tab: { id?: number; windowId: number; url?: string }): Promise<void> => {
    try {
      await handleTrigger(tab, triggerDeps);
    } catch (error) {
      console.error('[scenenote] trigger failed', error);
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

    // The 「記下這一刻」 button on a Netflix page: the tab is the one that sent it.
    if (message['type'] === 'scenenote/trigger') {
      const tab = sender.tab;
      if (tab?.id === undefined) return;
      handleTrigger(tab, triggerDeps, 'button').then(
        () => sendResponse({ ok: true }),
        (error: unknown) => {
          console.error('[scenenote] trigger from the page button failed', error);
          sendResponse({ ok: false });
        },
      );
      return true;
    }

    if (message['type'] === 'scenenote/shortcut') {
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
      jumpTo({ videoId: message.videoId, timeMs: message.timeMs }, jumpDeps).then(
        (result) => sendResponse({ ok: true, result } satisfies JumpResult),
        (error: unknown) => {
          console.error('[scenenote] could not jump back', error);
          sendResponse({ ok: false, error: String(error) } satisfies JumpResult);
        },
      );
      return true;
    }

    if (isRecentMessage(message)) {
      const limit = Math.min(Math.max(message.limit, 0), 5);
      void listRecent(message.videoId, limit, {
        listNotes,
        getImage,
        shrink: (bytes) => downscaleJpeg(bytes, RECENT_THUMB_WIDTH),
      }).then(sendResponse);
      return true;
    }

    if (message['type'] === 'scenenote/open-notebook') {
      browser.runtime.openOptionsPage().then(
        () => sendResponse({ ok: true }),
        (error: unknown) => {
          console.error('[scenenote] could not open the notebook', error);
          sendResponse({ ok: false, error: String(error) });
        },
      );
      return true;
    }
  });
});
