import { jumpTo, type JumpDeps } from '../background/jump';
import { handleSave } from '../background/save';
import { handleTrigger, type TriggerDeps } from '../background/trigger';
import type { JumpResult, ToBackground } from '../core/messages';

const CAPTURE_COMMAND = 'capture-scene';

type SaveMessage = Extract<ToBackground, { type: 'scenenote/save' }>;
type JumpMessage = Extract<ToBackground, { type: 'scenenote/jump' }>;

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
      const tabs = await browser.tabs.query({ url: 'https://www.netflix.com/watch/*' });
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
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRecord(message)) return;

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
