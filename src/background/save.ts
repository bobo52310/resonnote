import { getNote, putImage, putNote } from '../core/db';
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

/**
 * Stores edits made to an earlier note from the overlay. `updatedAt` moves on, so backups and
 * the notebook see the newer text. Never throws.
 */
export async function handleUpdate(
  msg: Extract<ToBackground, { type: 'scenenote/update' }>,
  now: () => Date = () => new Date(),
): Promise<SaveResult> {
  try {
    const note = await getNote(msg.id);
    if (!note) return { ok: false, error: '找不到這則筆記' };
    await putNote({
      ...note,
      subtitle: msg.subtitle.trimEnd(),
      body: msg.body.trimEnd(),
      updatedAt: now().toISOString(),
    });
    return { ok: true };
  } catch (error) {
    console.error('[scenenote] updating the note failed', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
