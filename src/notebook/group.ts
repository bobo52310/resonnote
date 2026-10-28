import { noteHeading } from '../core/format';
import type { Note } from '../core/types';

export interface NoteGroup {
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
 * Groups notes by `videoId`. Groups are ordered by the newest `createdAt` inside them, newest
 * first; notes inside a group by `timeMs` ascending (ties by `createdAt`). Does not mutate the
 * input.
 */
export function groupNotes(notes: Note[]): NoteGroup[] {
  const byVideo = new Map<string, Note[]>();
  for (const note of notes) {
    const bucket = byVideo.get(note.videoId);
    if (bucket) bucket.push(note);
    else byVideo.set(note.videoId, [note]);
  }

  const groups = [...byVideo].map(([videoId, list]) => {
    const sorted = [...list].sort(
      (a, b) => a.timeMs - b.timeMs || instant(a.createdAt) - instant(b.createdAt),
    );
    // The newest note carries the most recent title metadata.
    const newest = sorted.reduce((best, n) =>
      instant(n.createdAt) > instant(best.createdAt) ? n : best,
    );
    return {
      group: { videoId, heading: noteHeading(newest), notes: sorted },
      newest: instant(newest.createdAt),
    };
  });
  groups.sort((a, b) => b.newest - a.newest);
  return groups.map((entry) => entry.group);
}
