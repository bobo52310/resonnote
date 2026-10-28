import { handleSave } from '../background/save';
import { handleTrigger, type TriggerDeps } from '../background/trigger';
import type { ToBackground } from '../core/messages';

const CAPTURE_COMMAND = 'capture-scene';

type SaveMessage = Extract<ToBackground, { type: 'scenenote/save' }>;

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

export default defineBackground(() => {
  const triggerDeps: TriggerDeps = {
    sendToTab: (tabId, msg) => browser.tabs.sendMessage(tabId, msg),
    captureVisibleTab: (windowId) =>
      browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 }),
    openNotebook: () => browser.runtime.openOptionsPage(),
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
  // `scenenote/seek` is not handled here: the notebook's jump-back arrives with a later task.
  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRecord(message)) return;

    if (isSaveMessage(message)) {
      void handleSave(message).then(sendResponse);
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
