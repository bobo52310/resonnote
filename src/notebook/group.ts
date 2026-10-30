import { noteHeading } from '../core/format';
import type { Note, Platform } from '../core/types';

export interface NoteGroup {
  platform: Platform;
  videoId: string;
  heading: string;
  notes: Note[];
}

/** Milliseconds since the epoch for an ISO string; unparseable text sorts as the oldest. */
function instant(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Groups notes by platform and `videoId` (the same id string on two platforms is two videos).
 * Groups are ordered by the newest `createdAt` inside them, newest first; notes inside a group by
 * `timeMs` ascending (ties by `createdAt`). Does not mutate the input.
 */
export function groupNotes(notes: Note[]): NoteGroup[] {
  const byVideo = new Map<string, Note[]>();
  for (const note of notes) {
    // No platform name contains ':', so the key cannot collide.
    const key = `${note.platform}:${note.videoId}`;
    const bucket = byVideo.get(key);
    if (bucket) bucket.push(note);
    else byVideo.set(key, [note]);
  }

  const groups = [...byVideo.values()].map((list) => {
    const sorted = [...list].sort(
      (a, b) => a.timeMs - b.timeMs || instant(a.createdAt) - instant(b.createdAt),
    );
    // The newest note carries the most recent title metadata.
    const newest = sorted.reduce((best, n) =>
      instant(n.createdAt) > instant(best.createdAt) ? n : best,
    );
    return {
      group: {
        platform: newest.platform,
        videoId: newest.videoId,
        heading: noteHeading(newest),
        notes: sorted,
      },
      newest: instant(newest.createdAt),
    };
  });
  groups.sort((a, b) => b.newest - a.newest);
  return groups.map((entry) => entry.group);
}
