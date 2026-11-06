import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createBackupZip } from '../../src/core/backup';
import {
  closeDb,
  deleteNote,
  getImage,
  getNote,
  listNotes,
  putImage,
  putNote,
  updateNote,
  type NoteChanges,
} from '../../src/core/db';
import type { Note } from '../../src/core/types';
import { notesSignature, refreshIfChanged, refreshOnReturn } from '../../src/notebook/refresh';
import { getSelectedNotes, renderNotebook, type NotebookDeps } from '../../src/notebook/view';

vi.mock('../../src/export/download', () => ({ downloadBytes: vi.fn() }));

const NOW = new Date('2026-10-28T12:00:00.000Z');

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '81234567',
    title: '黑暗榮耀',
    season: 1,
    episode: 3,
    timeMs: 1_003_469,
    subtitle: '你好嗎',
    body: '原本的心得',
    image: { source: 'tab', width: 1280, height: 720 },
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

/** Deps backed by the real (fake-indexeddb) database, like the extension page itself. */
function realDeps(overrides: Partial<NotebookDeps> = {}): NotebookDeps {
  return {
    listNotes,
    updateNote,
    deleteNote,
    getImage,
    jump: () => {},
    now: () => NOW,
    ...overrides,
  };
}

let root: HTMLElement;

function noteEl(id: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!found) throw new Error(`note not found: ${id}`);
  return found;
}

function textareaOf(id: string): HTMLTextAreaElement {
  return noteEl(id).querySelector('textarea')!;
}

function checkbox(id: string): HTMLInputElement {
  return root.querySelector<HTMLInputElement>(`input.note-select[data-note-id="${id}"]`)!;
}

function setChecked(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** An in-page edit: type, leave the box, and wait until the write has landed in the database. */
async function editBody(id: string, body: string): Promise<void> {
  const textarea = textareaOf(id);
  textarea.value = body;
  textarea.dispatchEvent(new Event('blur'));
  await vi.waitFor(async () => expect((await getNote(id))?.body).toBe(body));
  await flush();
}

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  fakeBrowser.reset();
  URL.createObjectURL = vi.fn(() => 'blob:thumb');
  URL.revokeObjectURL = vi.fn();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});

describe('notesSignature', () => {
  it('does not depend on the order of the notes', () => {
    const a = makeNote('a');
    const b = makeNote('b');
    expect(notesSignature([a, b])).toBe(notesSignature([b, a]));
  });

  it('changes when a note is added, removed or edited', () => {
    const a = makeNote('a');
    const base = notesSignature([a]);
    expect(notesSignature([a, makeNote('b')])).not.toBe(base);
    expect(notesSignature([])).not.toBe(base);
    expect(notesSignature([{ ...a, updatedAt: '2026-10-28T00:00:00.000Z' }])).not.toBe(base);
  });
});

describe('refreshIfChanged: changes made inside the page do not trigger a re-render', () => {
  it('does nothing after an in-page body edit and keeps the selection', async () => {
    await putNote(makeNote('a', { timeMs: 1 }));
    await putNote(makeNote('b', { timeMs: 2 }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);
    const before = noteEl('a');

    await editBody('a', '改過的心得');

    expect(await refreshIfChanged(root, deps)).toBe(false);
    expect(noteEl('a')).toBe(before);
    expect(checkbox('a').checked).toBe(true);
    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['a']);
  });

  it('does nothing after an in-page delete', async () => {
    await putNote(makeNote('a', { timeMs: 1 }));
    await putNote(makeNote('b', { timeMs: 2 }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    setChecked(checkbox('b'), true);
    const remove = noteEl('a').querySelector<HTMLButtonElement>('.delete')!;
    remove.click();
    remove.click();
    await vi.waitFor(async () => expect(await getNote('a')).toBeUndefined());
    await flush();

    expect(await refreshIfChanged(root, deps)).toBe(false);
    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['b']);
  });

  it('does nothing after an in-page restore, and the restore keeps the selection', async () => {
    await putNote(makeNote('a', { timeMs: 1 }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);

    const zip = createBackupZip([makeNote('restored', { timeMs: 2 })], new Map());
    const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([zip.slice()], 'resonnote-backup.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(root.querySelector('[data-note-id="restored"]')).not.toBeNull());
    await flush();

    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['a']);
    expect(await refreshIfChanged(root, deps)).toBe(false);
  });

  it('does nothing when nothing changed at all', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    const before = noteEl('a');
    expect(await refreshIfChanged(root, deps)).toBe(false);
    expect(noteEl('a')).toBe(before);
  });

  it('does nothing for a root that was never rendered', async () => {
    expect(await refreshIfChanged(document.createElement('div'), realDeps())).toBe(false);
  });
});

describe('refreshIfChanged: changes made elsewhere do', () => {
  it('re-renders when a note was added to the database, keeping the checked ids', async () => {
    await putNote(makeNote('a', { timeMs: 1 }));
    await putNote(makeNote('b', { timeMs: 2 }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);
    const before = noteEl('a');

    // captured on a Netflix tab, saved by the background script
    await putNote(makeNote('c', { videoId: '999', title: '另一部' }));

    expect(await refreshIfChanged(root, deps)).toBe(true);
    expect(root.querySelector('[data-note-id="c"]')).not.toBeNull();
    expect(noteEl('a')).not.toBe(before);
    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['a']);
    expect(checkbox('b').checked).toBe(false);
    expect(checkbox('c').checked).toBe(false);
    // the group's 「全選」 box agrees with the restored selection
    const all = noteEl('a').closest('.group')!.querySelector<HTMLInputElement>('.group-select input')!;
    expect(all.indeterminate).toBe(true);
  });

  it('re-renders when a note was edited elsewhere, and drops selected ids that are gone', async () => {
    await putNote(makeNote('a', { timeMs: 1 }));
    await putNote(makeNote('b', { timeMs: 2 }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);
    setChecked(checkbox('b'), true);

    await putNote(makeNote('a', { timeMs: 1, body: '別處改的', updatedAt: '2026-10-27T00:00:00.000Z' }));
    await deleteNote('b');

    expect(await refreshIfChanged(root, deps)).toBe(true);
    expect(textareaOf('a').value).toBe('別處改的');
    expect(root.querySelector('[data-note-id="b"]')).toBeNull();
    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['a']);
  });

  it('puts the scroll position back after the redraw', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    await putNote(makeNote('c', { videoId: '999' }));

    expect(await refreshIfChanged(root, deps)).toBe(true);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 420);
  });
});

describe('refreshIfChanged: never while the user is writing', () => {
  it('does nothing while a textarea has focus', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    const textarea = textareaOf('a');
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    textarea.value = '打到一半';
    await putNote(makeNote('c', { videoId: '999' }));

    expect(await refreshIfChanged(root, deps)).toBe(false);
    expect(textarea.isConnected).toBe(true);
    expect(textarea.value).toBe('打到一半');
    expect(root.querySelector('[data-note-id="c"]')).toBeNull();
  });

  it('does nothing while a textarea holds text that has not been saved yet', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    const textarea = textareaOf('a');
    textarea.value = '還沒離開輸入框';
    await putNote(makeNote('c', { videoId: '999' }));

    expect(await refreshIfChanged(root, deps)).toBe(false);
    expect(textarea.isConnected).toBe(true);
    expect(textarea.value).toBe('還沒離開輸入框');
  });

  it('does nothing when the user starts typing while the list is being read', async () => {
    await putNote(makeNote('a'));
    await renderNotebook(root, realDeps());
    const textarea = textareaOf('a');
    const deps = realDeps({
      listNotes: vi.fn(async () => {
        textarea.focus();
        return listNotes();
      }),
    });
    await putNote(makeNote('c', { videoId: '999' }));

    expect(await refreshIfChanged(root, deps)).toBe(false);
    expect(textarea.isConnected).toBe(true);
  });

  it('waits for a save that is still running, then refreshes', async () => {
    await putNote(makeNote('a'));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = realDeps({
      updateNote: vi.fn(async (id: string, changes: NoteChanges) => {
        await gate;
        return updateNote(id, changes);
      }),
    });
    await renderNotebook(root, deps);
    const textarea = textareaOf('a');
    textarea.value = '正在存';
    textarea.dispatchEvent(new Event('blur'));
    await putNote(makeNote('c', { videoId: '999' }));

    expect(await refreshIfChanged(root, deps)).toBe(false);

    release();
    await vi.waitFor(async () => expect((await getNote('a'))?.body).toBe('正在存'));
    await flush();
    expect(await refreshIfChanged(root, deps)).toBe(true);
    expect(textareaOf('a').value).toBe('正在存');
    expect(root.querySelector('[data-note-id="c"]')).not.toBeNull();
  });
});

describe('refreshOnReturn', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
  });

  function visibility(state: 'visible' | 'hidden') {
    return vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  }

  it('catches up when the window gets focus (notebook shown side by side with Netflix)', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, deps);

    await putNote(makeNote('c', { videoId: '999', title: '另一部' }));
    window.dispatchEvent(new Event('focus'));

    await vi.waitFor(() => expect(root.querySelector('[data-note-id="c"]')).not.toBeNull());
  });

  it('catches up when the tab becomes visible', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, deps);
    visibility('visible');

    await putNote(makeNote('c', { videoId: '999', title: '另一部' }));
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(root.querySelector('[data-note-id="c"]')).not.toBeNull());
  });

  it('does not read anything when the tab becomes hidden', async () => {
    await putNote(makeNote('a'));
    const listNotesSpy = vi.fn(listNotes);
    const deps = realDeps({ listNotes: listNotesSpy });
    await renderNotebook(root, deps);
    listNotesSpy.mockClear();
    stop = refreshOnReturn(root, deps);
    visibility('hidden');

    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(listNotesSpy).not.toHaveBeenCalled();
  });

  it('keeps the same guards on focus: not while the user is writing', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, deps);
    const textarea = textareaOf('a');
    textarea.value = '打到一半';
    await putNote(makeNote('c', { videoId: '999' }));

    window.dispatchEvent(new Event('focus'));
    await flush();
    await flush();

    expect(textarea.isConnected).toBe(true);
    expect(textarea.value).toBe('打到一半');
    expect(root.querySelector('[data-note-id="c"]')).toBeNull();
  });

  it('runs one check and keeps the selection when focus and visibility fire together', async () => {
    await putNote(makeNote('a', { timeMs: 1 }));
    const listNotesSpy = vi.fn(listNotes);
    const deps = realDeps({ listNotes: listNotesSpy });
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);
    listNotesSpy.mockClear();
    stop = refreshOnReturn(root, deps);
    visibility('visible');

    await putNote(makeNote('c', { videoId: '999', title: '另一部' }));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(root.querySelector('[data-note-id="c"]')).not.toBeNull());
    await flush();
    // one read for the check and one for the redraw it triggered; a second check would add two more
    expect(listNotesSpy).toHaveBeenCalledTimes(2);
    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['a']);
  });

  it('can check again after an earlier check has finished', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, deps);

    await putNote(makeNote('c', { videoId: '999', title: '另一部' }));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(root.querySelector('[data-note-id="c"]')).not.toBeNull());
    await flush();

    await putNote(makeNote('d', { videoId: '888', title: '第三部' }));
    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(root.querySelector('[data-note-id="d"]')).not.toBeNull());
  });

  it('stops listening once the returned function is called', async () => {
    await putNote(makeNote('a'));
    const listNotesSpy = vi.fn(listNotes);
    const deps = realDeps({ listNotes: listNotesSpy });
    await renderNotebook(root, deps);
    listNotesSpy.mockClear();
    refreshOnReturn(root, deps)();
    visibility('visible');

    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(listNotesSpy).not.toHaveBeenCalled();
  });

  it('logs a failed read with the [resonnote] prefix instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, {
      ...deps,
      listNotes: async () => {
        throw new Error('db gone');
      },
    });

    window.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[resonnote\]/);
  });
});

describe('a box edited while the note changes elsewhere', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
  });

  it('does not bring back a note deleted elsewhere (overlay film strip) while it was on screen', async () => {
    await putImage('a', new Uint8Array([0xff, 0xd8, 1]).buffer);
    await putNote(makeNote('a', { timeMs: 1 }));
    await putNote(makeNote('b', { timeMs: 2 }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    const textarea = textareaOf('a');
    textarea.focus();

    // the background deletes it on a request from the overlay on a Netflix tab
    await deleteNote('a');
    textarea.value = '之後才在筆記本打的字';
    textarea.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(root.querySelector('[data-note-id="a"]')).toBeNull());

    expect(await getNote('a')).toBeUndefined();
    expect(await getImage('a')).toBeUndefined();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('已經在別處刪除');
    expect(root.querySelector('[data-note-id="b"]')).not.toBeNull();
  });

  it('keeps a subtitle fixed elsewhere (overlay) when the body is saved from a box drawn before', async () => {
    await putNote(makeNote('a', { subtitle: '舊台詞' }));
    const deps = realDeps();
    await renderNotebook(root, deps);

    await putNote(makeNote('a', { subtitle: '小視窗改好的台詞', updatedAt: '2026-10-27T00:00:00.000Z' }));
    await editBody('a', '筆記本補的心得');

    const stored = await getNote('a');
    expect(stored?.subtitle).toBe('小視窗改好的台詞');
    expect(stored?.body).toBe('筆記本補的心得');
    expect(stored?.updatedAt).toBe(NOW.toISOString());
  });

  it('redraws with the stored subtitle once the user leaves the box', async () => {
    await putNote(makeNote('a', { subtitle: '舊台詞' }));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, deps);
    const textarea = textareaOf('a');
    textarea.focus();

    await putNote(makeNote('a', { subtitle: '小視窗改好的台詞', updatedAt: '2026-10-27T00:00:00.000Z' }));
    // coming back to the page with the caret still in the box: no redraw yet
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(textareaOf('a')).toBe(textarea);

    textarea.value = '筆記本補的心得';
    textarea.blur();
    await vi.waitFor(() =>
      expect(noteEl('a').querySelector('.subtitle')?.textContent).toBe('小視窗改好的台詞'),
    );
    expect(textareaOf('a').value).toBe('筆記本補的心得');
    expect((await getNote('a'))?.subtitle).toBe('小視窗改好的台詞');
  });

  it('shows a note captured elsewhere once the user leaves the box that kept the redraw away', async () => {
    await putNote(makeNote('a'));
    const deps = realDeps();
    await renderNotebook(root, deps);
    stop = refreshOnReturn(root, deps);
    const textarea = textareaOf('a');
    textarea.focus();

    await putNote(makeNote('c', { videoId: '999', title: '另一部' }));
    window.dispatchEvent(new Event('focus'));
    await flush();
    await flush();
    expect(root.querySelector('[data-note-id="c"]')).toBeNull();

    // left without typing anything: there is nothing to save, but the skipped redraw is made up
    textarea.blur();
    await vi.waitFor(() => expect(root.querySelector('[data-note-id="c"]')).not.toBeNull());
  });
});
