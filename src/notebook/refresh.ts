import {
  getSelectedNotes,
  hasPendingEdits,
  notesSignature,
  renderNotebook,
  shownSignature,
  type NotebookDeps,
} from './view';

export { notesSignature };

/**
 * Catches the notebook up with changes made elsewhere (a note captured on a Netflix tab while this
 * page sat in the background). Resolves `true` when the page was redrawn.
 *
 * Changes made in the page itself never trigger a redraw: what the page shows is compared with
 * the database through the view's own state, which already includes in-page edits, deletes and
 * restores. A redraw is also skipped while the user is writing (see `hasPendingEdits`), and when
 * it does happen the checked notes stay checked and the scroll position is put back.
 */
export async function refreshIfChanged(root: HTMLElement, deps: NotebookDeps): Promise<boolean> {
  if (shownSignature(root) === null || hasPendingEdits(root)) return false;

  const stored = await deps.listNotes();

  // The user may have started typing, or changed something, while the list was being read.
  const shown = shownSignature(root);
  if (shown === null || hasPendingEdits(root)) return false;
  if (notesSignature(stored) === shown) return false;

  const selectedIds = getSelectedNotes(root).map((note) => note.id);
  const win = root.ownerDocument.defaultView;
  const scrollY = win?.scrollY ?? 0;
  await renderNotebook(root, deps, { selectedIds });
  win?.scrollTo(0, scrollY);
  return true;
}
