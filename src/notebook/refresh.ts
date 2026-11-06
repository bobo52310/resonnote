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

/**
 * Runs `refreshIfChanged` whenever the user comes back to the page: the tab becoming visible, or
 * the window getting focus. The second matters when the notebook sits beside the Netflix window,
 * where the page is never hidden and `visibilitychange` alone would not fire. Returns a function
 * that stops listening.
 *
 * Both events can arrive together; a check that is still running is not joined by a second one
 * (two redraws in a row would drop the checked notes the first one restored).
 */
export function refreshOnReturn(root: HTMLElement, deps: NotebookDeps): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let running = false;

  const check = () => {
    if (running) return;
    running = true;
    refreshIfChanged(root, deps)
      .catch((error: unknown) => console.warn('[resonnote] could not refresh the notebook', error))
      .finally(() => {
        running = false;
      });
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') check();
  };

  doc.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('focus', check);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win?.removeEventListener('focus', check);
  };
}
