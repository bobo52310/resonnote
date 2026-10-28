import { formatTime, noteHeading, safeFileName } from '../core/format';
import type { Note } from '../core/types';
import { createCanvasMeasure, layoutCard, renderCard } from './card';

export interface CardActionsDeps {
  getSelectedNotes: () => Note[];
  getImage: (id: string) => Promise<ArrayBuffer | undefined>;
  notify: (msg: string) => void;
}

const MSG_SELECT_FIRST = '先勾選要匯出的筆記';
const MSG_ONE_AT_A_TIME = '複製圖卡一次只能選一則';
const MSG_COPIED = '已複製，可以貼到 LINE';
const REVOKE_DELAY_MS = 10_000;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Decodes the stored JPEG; a missing or undecodable image yields `null` (card without picture). */
async function decodeImage(
  id: string,
  getImage: CardActionsDeps['getImage'],
): Promise<ImageBitmap | null> {
  const bytes = await getImage(id);
  if (!bytes) return null;
  try {
    return await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  } catch (err) {
    console.warn('[scenenote] could not decode note image, rendering card without it', err);
    return null;
  }
}

async function renderNoteCard(
  note: Note,
  getImage: CardActionsDeps['getImage'],
  measure: (text: string, font: string) => number,
): Promise<Blob> {
  const bitmap = await decodeImage(note.id, getImage);
  try {
    const layout = layoutCard(
      {
        imageWidth: bitmap?.width ?? 0,
        imageHeight: bitmap?.height ?? 0,
        heading: noteHeading(note),
        time: formatTime(note.timeMs),
        subtitle: note.subtitle,
        body: note.body,
      },
      measure,
    );
    return await renderCard(layout, bitmap);
  } finally {
    bitmap?.close();
  }
}

function cardFileName(note: Note): string {
  return `${safeFileName(noteHeading(note))}-${formatTime(note.timeMs).replaceAll(':', '-')}.png`;
}

// Private on purpose: the shared downloadBytes helper lands separately and will replace this.
function saveBlob(doc: Document, blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = fileName;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** Appends 「複製圖卡」 and 「下載圖卡」 buttons to the notebook toolbar. */
export function mountCardActions(toolbar: HTMLElement, deps: CardActionsDeps): void {
  const doc = toolbar.ownerDocument;
  const buttons: HTMLButtonElement[] = [];

  const makeButton = (label: string, role: string, run: () => Promise<void>) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.role = role;
    button.addEventListener('click', async () => {
      if (buttons.some((b) => b.disabled)) return;
      buttons.forEach((b) => (b.disabled = true));
      try {
        await run();
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    });
    buttons.push(button);
    toolbar.appendChild(button);
  };

  makeButton('複製圖卡', 'copy-card', async () => {
    const notes = deps.getSelectedNotes();
    const [note] = notes;
    if (!note) {
      deps.notify(MSG_SELECT_FIRST);
      return;
    }
    if (notes.length > 1) {
      deps.notify(MSG_ONE_AT_A_TIME);
      return;
    }
    try {
      const blob = await renderNoteCard(note, deps.getImage, createCanvasMeasure());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      deps.notify(MSG_COPIED);
    } catch (err) {
      console.warn('[scenenote] copy card failed', err);
      deps.notify('複製失敗：' + errorMessage(err));
    }
  });

  makeButton('下載圖卡', 'download-card', async () => {
    const notes = deps.getSelectedNotes();
    if (notes.length === 0) {
      deps.notify(MSG_SELECT_FIRST);
      return;
    }
    try {
      const measure = createCanvasMeasure();
      for (const note of notes) {
        const blob = await renderNoteCard(note, deps.getImage, measure);
        saveBlob(doc, blob, cardFileName(note));
      }
    } catch (err) {
      console.warn('[scenenote] download card failed', err);
      deps.notify('下載失敗：' + errorMessage(err));
    }
  });
}
