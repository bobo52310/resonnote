import { browser } from 'wxt/browser';
import { deleteNote, getImage, listNotes, putNote } from '../../core/db';
import type { ToBackground } from '../../core/messages';
import { createJump } from '../../notebook/jump-client';
import { refreshOnReturn } from '../../notebook/refresh';
import { notifyNotebook, renderNotebook, type NotebookDeps } from '../../notebook/view';

const root = document.getElementById('notebook');
if (!root) throw new Error('[scenenote] #notebook is missing from the options page');

const deps: NotebookDeps = {
  listNotes,
  putNote,
  deleteNote,
  getImage,
  jump: createJump(
    (message: ToBackground) => browser.runtime.sendMessage(message),
    (message) => {
      notifyNotebook(root, message);
    },
  ),
  now: () => new Date(),
};

renderNotebook(root, deps).catch((error: unknown) =>
  console.error('[scenenote] could not draw the notebook', error),
);

// Notes are saved from Netflix tabs while this page may sit open in the background (the toolbar
// button focuses the existing tab instead of reloading it), or beside the Netflix window, so catch
// up when the tab is shown or the window is focused. Changes made in the page itself, and a note
// being typed, are left alone.
refreshOnReturn(root, deps);
