import type { ToContent } from '../core/messages';
import { detectWatchPage, PLATFORM_INFO } from '../platforms/registry';

export interface TriggerDeps {
  sendToTab: (tabId: number, msg: ToContent) => Promise<unknown>;
  /** The visible tab as a JPEG data URL (quality 90). */
  captureVisibleTab: (windowId: number) => Promise<string>;
  openNotebook: () => Promise<void>;
  /** Sets the toolbar button's badge text and tooltip for one tab (`''` text = no badge). */
  setBadge: (tabId: number, text: string, title: string) => Promise<void>;
}

/** Shown on the toolbar button of a watch tab the content script cannot be reached on. */
export const RELOAD_BADGE = '!';
/** The tooltip that goes with the badge; `label` is the platform's name (Netflix, YouTube, Disney+). */
export function reloadTitle(label: string): string {
  return `請重新整理這個 ${label} 分頁後再按一次`;
}
/** The button's normal tooltip; must equal `action.default_title` in wxt.config.ts. */
export const DEFAULT_ACTION_TITLE = '記下這一刻（ResonNote）';

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
    console.warn('[resonnote] could not update the toolbar badge', error);
  }
}

/**
 * Shortcut / toolbar click. On a watch page (Netflix, YouTube or Disney+): the content script is
 * asked to begin FIRST (it reads the page and refuses when the overlay is already open), and only
 * then is the screenshot taken, so the overlay can never be in the picture and a second press
 * cannot capture. Anywhere else the notebook opens.
 *
 * `'no-video'` also covers a page the content script cannot be reached on (for example a tab
 * that was already open when the extension was loaded, which needs a reload). That case also puts
 * a `!` badge on the toolbar button of the tab, because nothing else would show on the page; the
 * badge is cleared again as soon as the page answers.
 */
export async function handleTrigger(
  tab: { id?: number; windowId: number; url?: string },
  deps: TriggerDeps,
  /**
   * `'button'`: pressed on the page. Chrome only lets the screenshot through once the shortcut or
   * the toolbar button has been used in the tab (activeTab), so a failed screenshot then comes
   * with a hint for the overlay.
   */
  source: 'shortcut' | 'button' = 'shortcut',
): Promise<TriggerOutcome> {
  const tabId = tab.id;
  const page = detectWatchPage(tab.url);
  if (page === null || tabId === undefined) {
    await deps.openNotebook();
    return 'notebook';
  }
  const { label } = PLATFORM_INFO[page.platform];
  const reloadHint = reloadTitle(label);

  let status: string | null;
  try {
    status = beginStatus(await deps.sendToTab(tabId, { type: 'resonnote/begin' }));
  } catch (error) {
    console.warn(`[resonnote] could not reach the page; reload the ${label} tab`, error);
    await updateBadge(deps, tabId, RELOAD_BADGE, reloadHint);
    return 'no-video';
  }
  if (status === null) {
    // Nobody answered properly: same cure as for a page that cannot be reached.
    await updateBadge(deps, tabId, RELOAD_BADGE, reloadHint);
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
    console.warn('[resonnote] screenshot failed, continuing without it', error);
  }
  const show: ToContent =
    dataUrl === null && source === 'button'
      ? { type: 'resonnote/show', dataUrl, hint: 'use-shortcut-once' }
      : { type: 'resonnote/show', dataUrl };

  try {
    await deps.sendToTab(tabId, show);
  } catch (error) {
    console.warn('[resonnote] could not show the note overlay', error);
    return 'no-video';
  }
  return 'shown';
}
