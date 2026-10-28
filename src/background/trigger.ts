import type { ToContent } from '../core/messages';
import { parseWatchVideoId } from '../platforms/netflix/url';

export interface TriggerDeps {
  sendToTab: (tabId: number, msg: ToContent) => Promise<unknown>;
  /** The visible tab as a JPEG data URL (quality 90). */
  captureVisibleTab: (windowId: number) => Promise<string>;
  openNotebook: () => Promise<void>;
}

export type TriggerOutcome = 'notebook' | 'busy' | 'no-video' | 'shown';

function beginStatus(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const status = (answer as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

/**
 * Shortcut / toolbar click. On a Netflix watch page: the content script is asked to begin
 * FIRST (it reads the page and refuses when the overlay is already open), and only then is the
 * screenshot taken, so the overlay can never be in the picture and a second press cannot
 * capture. Anywhere else the notebook opens.
 *
 * `'no-video'` also covers a page the content script cannot be reached on (for example a tab
 * that was already open when the extension was loaded, which needs a reload).
 */
export async function handleTrigger(
  tab: { id?: number; windowId: number; url?: string },
  deps: TriggerDeps,
): Promise<TriggerOutcome> {
  const tabId = tab.id;
  if (parseWatchVideoId(tab.url) === null || tabId === undefined) {
    await deps.openNotebook();
    return 'notebook';
  }

  let status: string | null;
  try {
    status = beginStatus(await deps.sendToTab(tabId, { type: 'scenenote/begin' }));
  } catch (error) {
    console.warn('[scenenote] could not reach the page; reload the Netflix tab', error);
    return 'no-video';
  }
  if (status === 'busy') return 'busy';
  if (status !== 'ok') return 'no-video';

  let dataUrl: string | null = null;
  try {
    const shot = await deps.captureVisibleTab(tab.windowId);
    if (typeof shot === 'string' && shot !== '') dataUrl = shot;
  } catch (error) {
    console.warn('[scenenote] screenshot failed, continuing without it', error);
  }

  try {
    await deps.sendToTab(tabId, { type: 'scenenote/show', dataUrl });
  } catch (error) {
    console.warn('[scenenote] could not show the note overlay', error);
    return 'no-video';
  }
  return 'shown';
}
