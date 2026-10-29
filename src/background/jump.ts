import type { ToContent } from '../core/messages';
import type { Note } from '../core/types';
import { PLATFORM_INFO } from '../platforms/registry';

export interface JumpDeps {
  /** The tabs whose url matches one of the match patterns. */
  queryTabs(patterns: string[]): Promise<{ id: number; windowId: number; url?: string }[]>;
  /** Brings the tab (and its window) to the front. */
  focus(tabId: number, windowId: number): Promise<void>;
  sendToTab(tabId: number, msg: ToContent): Promise<unknown>;
  /** Opens `url` in a new tab; resolves with the new tab's id when the browser gives one. */
  createTab(url: string): Promise<number | undefined>;
  /** Points an existing tab at `url`. */
  updateTabUrl(tabId: number, url: string): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** How often a freshly opened page is asked to seek, and how many times before giving up (30 s). */
export const SEEK_RETRY_MS = 1000;
export const SEEK_RETRY_LIMIT = 30;

/**
 * For platforms whose link cannot carry a time: the page has to load and its player has to start
 * before it obeys a seek (a seek during the first moments is ignored), so ask once a second until
 * the content script says it worked. A message that throws (the content script is not there yet)
 * counts as a failed attempt. Giving up only logs; the user is on the right video either way.
 */
async function seekWhenReady(
  tabId: number,
  timeMs: number,
  label: string,
  deps: JumpDeps,
): Promise<void> {
  for (let attempt = 0; attempt < SEEK_RETRY_LIMIT; attempt++) {
    await deps.wait(SEEK_RETRY_MS);
    try {
      const reply = await deps.sendToTab(tabId, { type: 'scenenote/seek', timeMs });
      if (reply === true) return;
    } catch {
      // Still loading: the content script answers a later attempt.
    }
  }
  console.warn(`[scenenote] could not seek the ${label} tab to the moment; it stays where it is`);
}

/**
 * Takes the user back to a note's moment. A tab already on the same video (same platform and
 * same videoId) is focused and sought; otherwise a new tab opens on the platform's link.
 *
 * When the tab cannot be sought (no content script, for example because it was open before the
 * extension loaded, or the seek failed) the tab is navigated to the link instead, so the
 * result is still `'existing'`.
 *
 * Where the link does not start at the moment (`linkKeepsTime` is false, Disney+) the seek is
 * retried on the freshly opened or navigated tab until the player accepts it.
 */
export async function jumpTo(
  note: Pick<Note, 'platform' | 'videoId' | 'timeMs'>,
  deps: JumpDeps,
): Promise<'existing' | 'new'> {
  const info = PLATFORM_INFO[note.platform];
  const url = info.watchUrl(note.videoId, note.timeMs);
  const tabs = await deps.queryTabs(info.tabPatterns);
  // Each platform's parser only accepts its own site, so this is "same platform and same id".
  const tab = tabs.find((t) => info.parseWatchVideoId(t.url) === note.videoId);
  if (!tab) {
    const newTabId = await deps.createTab(url);
    if (!info.linkKeepsTime && newTabId !== undefined) {
      await seekWhenReady(newTabId, note.timeMs, info.label, deps);
    }
    return 'new';
  }

  await deps.focus(tab.id, tab.windowId);
  let sought = false;
  try {
    const reply = await deps.sendToTab(tab.id, { type: 'scenenote/seek', timeMs: note.timeMs });
    sought = reply === true;
  } catch (error) {
    console.warn(`[scenenote] could not reach the ${info.label} tab, navigating it instead`, error);
  }
  if (!sought) {
    await deps.updateTabUrl(tab.id, url);
    if (!info.linkKeepsTime) await seekWhenReady(tab.id, note.timeMs, info.label, deps);
  }
  return 'existing';
}
