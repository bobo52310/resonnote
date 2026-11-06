import { strToU8, zipSync, type Zippable } from 'fflate';
import { formatTime } from '../core/format';
import { isPlainNoteId } from '../core/note-id';
import type { Note } from '../core/types';
import { PLATFORM_INFO, watchLinkText } from '../platforms/registry';
import { groupByHeading } from './group';

const MARKDOWN_FILE = 'notes.md';
const IMAGE_DIR = 'images';

/**
 * The path of each note's picture inside the zip, by note id: `images/<id>.jpg`. An id that is
 * not a plain one (only a backup restored before ids were checked could have brought it in) gets
 * a numbered stand-in instead, `images/note.<n>.jpg`, which no plain id can collide with: no
 * entry may climb out of `images/` when the zip is unpacked. Depends only on `notes`, so the
 * links in notes.md and the zip entries always agree.
 */
function imagePaths(notes: Note[]): Map<string, string> {
  const paths = new Map<string, string>();
  let standIns = 0;
  for (const { id } of notes) {
    if (paths.has(id)) continue;
    const name = isPlainNoteId(id) ? id : `note.${++standIns}`;
    paths.set(id, `${IMAGE_DIR}/${name}.jpg`);
  }
  return paths;
}

/**
 * Plain text as Markdown text. Titles and captions come from the streaming site (on YouTube the
 * uploader writes them), and the notes may be pasted into a blog engine that lets raw HTML and
 * `javascript:` links through. So `&`, `<` and `>` become entities (no tag can start, in any
 * Markdown flavour), and `\`, `` ` ``, `[` and `]` are backslash-escaped (no link, image or code
 * span can start, and an escape cannot be undone by a backslash before it). Rendered, the text
 * reads exactly as it was written.
 */
function escapeText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`[\]]/g, '\\$&');
}

/**
 * A link target we build from a stored note: the characters that would end it early or start
 * markup (spaces, control characters, parentheses, angle and square brackets, `\`, `` ` ``) are
 * percent-encoded. Real watch links have none of them, so they come out unchanged.
 */
function linkTarget(url: string): string {
  return url.replace(
    /[\x00-\x20\x7f()<>[\]\\`]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

function noteBlocks(note: Note, imagePath: string | null): string[] {
  const time = formatTime(note.timeMs);
  const blocks = [`## ${time}`];
  if (imagePath !== null) blocks.push(`![${time}](${imagePath})`);
  if (note.subtitle !== '') {
    blocks.push(
      note.subtitle
        .split(/\r?\n/)
        .map((line) => `> ${escapeText(line)}`)
        .join('\n'),
    );
  }
  if (note.body !== '') blocks.push(escapeText(note.body));
  const link = linkTarget(PLATFORM_INFO[note.platform].watchUrl(note.videoId, note.timeMs));
  blocks.push(`[${escapeText(watchLinkText(note.platform, note.timeMs))}](${link})`);
  return blocks;
}

/**
 * Markdown for the blog: one `# heading` per title/episode, one `## m:ss` section per note.
 * `hasImage(id)` decides whether the image line is written; blocks are separated by one
 * blank line and the text ends with a single newline. Empty input gives an empty string.
 * Titles, captions and thoughts are written as text, never as markup (see `escapeText`).
 */
export function buildMarkdown(notes: Note[], hasImage: (id: string) => boolean): string {
  const paths = imagePaths(notes);
  const blocks: string[] = [];
  for (const group of groupByHeading(notes)) {
    // A heading is one line: a line break in a title would end it and start other blocks.
    blocks.push(`# ${escapeText(group.heading.replace(/\s*[\r\n]+\s*/g, ' '))}`);
    for (const note of group.notes) {
      blocks.push(...noteBlocks(note, hasImage(note.id) ? (paths.get(note.id) ?? null) : null));
    }
  }
  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`;
}

/** `notes.md` plus `images/<id>.jpg` for each exported note that has image bytes in `images`. */
export function buildMarkdownZip(notes: Note[], images: Map<string, Uint8Array>): Uint8Array {
  const included = new Map<string, Uint8Array>();
  for (const note of notes) {
    const bytes = images.get(note.id);
    if (bytes) included.set(note.id, bytes);
  }
  const files: Zippable = {
    [MARKDOWN_FILE]: strToU8(buildMarkdown(notes, (id) => included.has(id))),
  };
  const paths = imagePaths(notes);
  for (const [id, bytes] of included) {
    const path = paths.get(id);
    // JPEG data is already compressed, so store it as-is.
    if (path !== undefined) files[path] = [bytes, { level: 0 }];
  }
  return zipSync(files);
}
