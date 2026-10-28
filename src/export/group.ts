import { noteHeading } from '../core/format';
import type { Note } from '../core/types';

export interface NoteGroup {
  heading: string;
  notes: Note[];
}

/**
 * Groups notes by `noteHeading` (groups keep the order they first appear in) and sorts
 * each group by `timeMs`. Does not mutate the input.
 */
export function groupByHeading(notes: Note[]): NoteGroup[] {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const heading = noteHeading(note);
    const bucket = groups.get(heading);
    if (bucket) bucket.push(note);
    else groups.set(heading, [note]);
  }
  return [...groups].map(([heading, list]) => ({
    heading,
    notes: [...list].sort((a, b) => a.timeMs - b.timeMs),
  }));
}
