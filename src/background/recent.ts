import type { getImage, listNotes } from '../core/db';
import type { RecentNote } from '../core/messages';
import type { Platform } from '../core/types';

export interface RecentDeps {
  listNotes: typeof listNotes;
  getImage: typeof getImage;
  /** JPEG bytes -> a small `data:` URL for the overlay. */
  shrink: (bytes: ArrayBuffer) => Promise<string>;
}

/** Width of the pictures sent to the overlay: they are shown at most 240 px wide (2x for retina). */
export const RECENT_THUMB_WIDTH = 480;

/**
 * The newest `limit` notes of one video (same platform and `videoId`; by when they were written),
 * newest first, each with a shrunken picture. A picture that cannot be read or shrunk comes back as `null`. Never throws.
 */
export async function listRecent(
  platform: Platform,
  videoId: string,
  limit: number,
  deps: RecentDeps,
): Promise<RecentNote[]> {
  try {
    const notes = (await deps.listNotes())
      .filter((note) => note.platform === platform && note.videoId === videoId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
    return await Promise.all(
      notes.map(async (note): Promise<RecentNote> => {
        let thumb: string | null = null;
        if (note.image.source !== 'none') {
          try {
            const bytes = await deps.getImage(note.id);
            if (bytes) thumb = await deps.shrink(bytes);
          } catch (error) {
            console.warn('[resonnote] could not prepare an earlier picture', error);
          }
        }
        return { id: note.id, timeMs: note.timeMs, subtitle: note.subtitle, body: note.body, thumb };
      }),
    );
  } catch (error) {
    console.error('[resonnote] could not read the earlier notes', error);
    return [];
  }
}
