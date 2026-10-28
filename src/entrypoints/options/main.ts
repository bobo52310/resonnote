import { browser } from 'wxt/browser';
import { deleteNote, getImage, listNotes, putNote } from '../../core/db';
import type { JumpResult, ToBackground } from '../../core/messages';
import type { Note } from '../../core/types';
import { refreshIfChanged } from '../../notebook/refresh';
import { renderNotebook, type NotebookDeps } from '../../notebook/view';

const root = document.getElementById('notebook');
if (!root) throw new Error('[scenenote] #notebook is missing from the options page');

async function jump(note: Note): Promise<void> {
  const message: ToBackground = {
    type: 'scenenote/jump',
    videoId: note.videoId,
    timeMs: note.timeMs,
  };
  const reply = (await browser.runtime.sendMessage(message)) as JumpResult | undefined;
  if (reply && !reply.ok) console.warn('[scenenote] could not jump back', reply.error);
}

const deps: NotebookDeps = {
  listNotes,
  putNote,
  deleteNote,
  getImage,
  jump: (note) => {
    jump(note).catch((error: unknown) => console.warn('[scenenote] could not jump back', error));
  },
  now: () => new Date(),
};

renderNotebook(root, deps).catch((error: unknown) =>
  console.error('[scenenote] could not draw the notebook', error),
);

// Notes are saved from Netflix tabs while this page may sit open in the background (the toolbar
// button focuses the existing tab instead of reloading it), so catch up when the tab is shown.
// Changes made in the page itself, and a note being typed, are left alone.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshIfChanged(root, deps).catch((error: unknown) =>
    console.warn('[scenenote] could not refresh the notebook', error),
  );
});
