import type { ToContent } from '../core/messages';
import { parseWatchVideoId } from '../platforms/netflix/url';

export interface TriggerDeps {
  sendToTab: (tabId: number, msg: ToContent) => Promise<unknown>;
  /** The visible tab as a JPEG data URL (quality 90). */
  captureVisibleTab: (windowId: number) => Promise<string>;
  openNotebook: () => Promise<void>;
  /** Sets the toolbar button's badge text and tooltip for one tab (`''` text = no badge). */
  setBadge: (tabId: number, text: string, title: string) => Promise<void>;
}

/** Shown on the toolbar button of a Netflix tab the content script cannot be reached on. */
export const RELOAD_BADGE = '!';
export const RELOAD_TITLE = '請重新整理這個 Netflix 分頁後再按一次';
/** The button's normal tooltip; must equal `action.default_title` in wxt.config.ts. */
export const DEFAULT_ACTION_TITLE = '記下這一刻（scenenote）';

export type TriggerOutcome = 'notebook' | 'busy' | 'no-video' | 'shown';

function beginStatus(answer: unknown): string | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const status = (answer as { status?: unknown }).status;
  return typeof status === 'string' ? status : null;
}

/** Badge updates are a courtesy: a failure (for example a tab that just closed) is only logged. */
async function updateBadge(
  deps: TriggerDeps,
  tabId: number,
  text: string,
  title: string,
): Promise<void> {
  try {
    await deps.setBadge(tabId, text, title);
  } catch (error) {
    console.warn('[scenenote] could not update the toolbar badge', error);
  }
}

/**
 * Shortcut / toolbar click. On a Netflix watch page: the content script is asked to begin
 * FIRST (it reads the page and refuses when the overlay is already open), and only then is the
 * screenshot taken, so the overlay can never be in the picture and a second press cannot
 * capture. Anywhere else the notebook opens.
 *
 * `'no-video'` also covers a page the content script cannot be reached on (for example a tab
 * that was already open when the extension was loaded, which needs a reload). That case also puts
 * a `!` badge on the toolbar button of the tab, because nothing else would show on the page; the
 * badge is cleared again as soon as the page answers.
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
    await updateBadge(deps, tabId, RELOAD_BADGE, RELOAD_TITLE);
    return 'no-video';
  }
  if (status === null) {
    // Nobody answered properly: same cure as for a page that cannot be reached.
    await updateBadge(deps, tabId, RELOAD_BADGE, RELOAD_TITLE);
    return 'no-video';
  }
  // The page answered, so any earlier "reload me" badge is out of date. Not awaited: the
  // screenshot must follow `begin` as closely as possible.
  void updateBadge(deps, tabId, '', DEFAULT_ACTION_TITLE);
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
