import { noteHeading, safeFileName } from '../core/format';
import type { Note } from '../core/types';
import { downloadBytes } from './download';
import { buildHtml } from './html';
import { downscaleJpeg } from './image';
import { buildMarkdownZip } from './markdown';

export interface ExportFileDeps {
  getSelectedNotes: () => Note[];
  getImage: (id: string) => Promise<ArrayBuffer | undefined>;
  notify: (msg: string) => void;
}

const HTML_IMAGE_MAX_WIDTH = 1280;
const MSG_NEED_SELECTION = '先勾選要匯出的筆記';
const MSG_EXPORT_FAILED = '匯出失敗，請再試一次';

/** Reads the stored JPEG of every note that was captured with one; missing images are skipped. */
async function loadImages(
  notes: Note[],
  getImage: ExportFileDeps['getImage'],
): Promise<Map<string, ArrayBuffer>> {
  const images = new Map<string, ArrayBuffer>();
  for (const note of notes) {
    if (note.image.source === 'none') continue;
    const buffer = await getImage(note.id);
    if (buffer) images.set(note.id, buffer);
  }
  return images;
}

function pageTitle(notes: Note[]): string {
  const headings = [...new Set(notes.map((note) => noteHeading(note)))];
  const first = headings[0] ?? '';
  return headings.length <= 1 ? first : `${first} 等 ${headings.length} 部作品的筆記`;
}

/** File name without extension: the first selected note's heading, made safe. */
function fileBase(notes: Note[]): string {
  const first = notes[0];
  return safeFileName(first ? noteHeading(first) : '');
}

async function exportHtml(notes: Note[], deps: ExportFileDeps): Promise<void> {
  const images = await loadImages(notes, deps.getImage);
  const dataUrls = new Map<string, string>();
  for (const [id, buffer] of images) {
    try {
      dataUrls.set(id, await downscaleJpeg(buffer, HTML_IMAGE_MAX_WIDTH));
    } catch (error) {
      console.warn('[resonnote] could not downscale an image, exporting without it', error);
    }
  }
  const html = buildHtml(pageTitle(notes), notes, dataUrls);
  downloadBytes(`${fileBase(notes)}.html`, html, 'text/html;charset=utf-8');
}

async function exportMarkdownZip(notes: Note[], deps: ExportFileDeps): Promise<void> {
  const images = await loadImages(notes, deps.getImage);
  const bytes = new Map<string, Uint8Array>();
  for (const [id, buffer] of images) bytes.set(id, new Uint8Array(buffer));
  const zip = buildMarkdownZip(notes, bytes);
  downloadBytes(`${fileBase(notes)}-notes.zip`, zip, 'application/zip');
}

function addButton(
  toolbar: HTMLElement,
  label: string,
  kind: string,
  run: (notes: Note[]) => Promise<void>,
  deps: ExportFileDeps,
): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.export = kind;
  button.addEventListener('click', () => {
    void (async () => {
      const notes = deps.getSelectedNotes();
      if (notes.length === 0) {
        deps.notify(MSG_NEED_SELECTION);
        return;
      }
      button.disabled = true;
      try {
        await run(notes);
      } catch (error) {
        console.error('[resonnote] export failed', error);
        deps.notify(MSG_EXPORT_FAILED);
      } finally {
        button.disabled = false;
      }
    })();
  });
  toolbar.append(button);
}

/**
 * Adds the 「匯出網頁檔」 and 「匯出 Markdown」 buttons to `toolbar`. Both act on the currently
 * selected notes; with none selected they only call `deps.notify`.
 */
export function mountExportFileActions(toolbar: HTMLElement, deps: ExportFileDeps): void {
  addButton(toolbar, '匯出網頁檔', 'html', (notes) => exportHtml(notes, deps), deps);
  addButton(toolbar, '匯出 Markdown', 'markdown', (notes) => exportMarkdownZip(notes, deps), deps);
}
