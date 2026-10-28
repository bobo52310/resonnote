import { putImage, putNote } from '../core/db';
import { dataUrlToBytes, type SaveResult, type ToBackground } from '../core/messages';

/**
 * Stores a note and its image. The image goes first: a failure between the two writes then
 * leaves an unreferenced image (overwritten by the retry, which reuses the note id) instead
 * of a note that claims a picture it does not have. Never throws.
 */
export async function handleSave(
  msg: Extract<ToBackground, { type: 'scenenote/save' }>,
): Promise<SaveResult> {
  try {
    if (msg.imageDataUrl !== null) {
      const bytes = dataUrlToBytes(msg.imageDataUrl);
      await putImage(msg.note.id, bytes.buffer);
    }
    await putNote(msg.note);
    return { ok: true };
  } catch (error) {
    console.error('[scenenote] saving the note failed', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
