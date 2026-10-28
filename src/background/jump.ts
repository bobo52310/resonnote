import type { ToContent } from '../core/messages';
import type { Note } from '../core/types';
import { parseWatchVideoId, watchUrl } from '../platforms/netflix/url';

export interface JumpDeps {
  queryNetflixTabs(): Promise<{ id: number; windowId: number; url?: string }[]>;
  /** Brings the tab (and its window) to the front. */
  focus(tabId: number, windowId: number): Promise<void>;
  sendToTab(tabId: number, msg: ToContent): Promise<unknown>;
  createTab(url: string): Promise<void>;
  /** Points an existing tab at `url`. */
  updateTabUrl(tabId: number, url: string): Promise<void>;
}

/**
 * Takes the user back to a note's moment. A tab already on the same video is focused and
 * sought; otherwise a new tab opens on the deep link.
 *
 * When the tab cannot be sought (no content script, for example because it was open before the
 * extension loaded, or the seek failed) the tab is navigated to the deep link instead, so the
 * result is still `'existing'`.
 */
export async function jumpTo(
  note: Pick<Note, 'videoId' | 'timeMs'>,
  deps: JumpDeps,
): Promise<'existing' | 'new'> {
  const url = watchUrl(note.videoId, note.timeMs);
  const tabs = await deps.queryNetflixTabs();
  const tab = tabs.find((t) => parseWatchVideoId(t.url) === note.videoId);
  if (!tab) {
    await deps.createTab(url);
    return 'new';
  }

  await deps.focus(tab.id, tab.windowId);
  let sought = false;
  try {
    const reply = await deps.sendToTab(tab.id, { type: 'scenenote/seek', timeMs: note.timeMs });
    sought = reply === true;
  } catch (error) {
    console.warn('[scenenote] could not reach the Netflix tab, navigating it instead', error);
  }
  if (!sought) await deps.updateTabUrl(tab.id, url);
  return 'existing';
}
