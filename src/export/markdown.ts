import { strToU8, zipSync, type Zippable } from 'fflate';
import { formatTime } from '../core/format';
import type { Note } from '../core/types';
import { PLATFORM_INFO, watchLinkText } from '../platforms/registry';
import { groupByHeading } from './group';

const MARKDOWN_FILE = 'notes.md';
const IMAGE_DIR = 'images';

function imageRelPath(id: string): string {
  return `${IMAGE_DIR}/${id}.jpg`;
}

function noteBlocks(note: Note, hasImage: (id: string) => boolean): string[] {
  const time = formatTime(note.timeMs);
  const blocks = [`## ${time}`];
  if (hasImage(note.id)) blocks.push(`![${time}](${imageRelPath(note.id)})`);
  if (note.subtitle !== '') {
    blocks.push(
      note.subtitle
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join('\n'),
    );
  }
  if (note.body !== '') blocks.push(note.body);
  const link = PLATFORM_INFO[note.platform].watchUrl(note.videoId, note.timeMs);
  blocks.push(`[${watchLinkText(note.platform, note.timeMs)}](${link})`);
  return blocks;
}

/**
 * Markdown for the blog: one `# heading` per title/episode, one `## m:ss` section per note.
 * `hasImage(id)` decides whether the image line is written; blocks are separated by one
 * blank line and the text ends with a single newline. Empty input gives an empty string.
 */
export function buildMarkdown(notes: Note[], hasImage: (id: string) => boolean): string {
  const blocks: string[] = [];
  for (const group of groupByHeading(notes)) {
    blocks.push(`# ${group.heading}`);
    for (const note of group.notes) blocks.push(...noteBlocks(note, hasImage));
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
  for (const [id, bytes] of included) {
    // JPEG data is already compressed, so store it as-is.
    files[imageRelPath(id)] = [bytes, { level: 0 }];
  }
  return zipSync(files);
}
