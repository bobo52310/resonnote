/**
 * Note ids are made by `crypto.randomUUID()`: 36 hex digits and hyphens. They also name files in
 * the backup and Markdown zips (`images/<id>.jpg`), so an id that comes in from a backup file
 * must be a plain one: letters, digits, `_` and `-` only, 1 to 64 of them. Nothing a path could
 * be made of (`/`, `\`, `.`, `:`), so no zip entry can climb out of `images/`.
 */
const PLAIN_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isPlainNoteId(id: string): boolean {
  return PLAIN_ID.test(id);
}
