import {
  BackupFormatError,
  exportAllBackup,
  getLastBackupAt,
  needsBackupReminder,
  restoreBackup,
  setLastBackupAt,
} from '../core/backup';
import type { deleteNote, getImage, listNotes, putNote } from '../core/db';
import { formatTime } from '../core/format';
import type { Note } from '../core/types';
import { mountCardActions } from '../export/card-actions';
import { downloadBytes } from '../export/download';
import { mountExportFileActions } from '../export/file-actions';
import { groupNotes, type NoteGroup } from './group';

export interface NotebookDeps {
  listNotes: typeof listNotes;
  putNote: typeof putNote;
  deleteNote: typeof deleteNote;
  getImage: typeof getImage;
  /** Takes the user back to the note's moment in Netflix. */
  jump: (note: Note) => void;
  now: () => Date;
}

const DAY_MS = 86_400_000;
const CONFIRM_DELETE_MS = 3000;
/** How long the typing has to pause before the body is saved (a tab can be closed at any time). */
const SAVE_DEBOUNCE_MS = 500;
const EMPTY_TEXT = '還沒有筆記。在 Netflix 播放時按 ⌥⇧N 記下第一則。';
const MSG_NOT_A_BACKUP = '這不是 scenenote 的備份檔，或檔案已損壞';

interface ViewState {
  deps: NotebookDeps;
  /** The notes as shown on screen (including edits), by id. */
  notes: Map<string, Note>;
  /** Object URLs of the thumbnails currently on screen, by note id. */
  thumbUrls: Map<string, string>;
  timers: Set<ReturnType<typeof setTimeout>>;
  /** Bumped by every (re)load of the list, so slow thumbnail reads of an older list are dropped. */
  loadSeq: number;
  /** Body writes that have started but not finished. */
  pendingSaves: number;
  disposed: boolean;
  /** Takes the page-level listeners (pagehide, visibilitychange) off again. */
  removeListeners: () => void;
  groupsEl: HTMLElement;
  /** Shows one picture at full size; opened by clicking a thumbnail. */
  lightbox: HTMLDialogElement;
  backupBar: HTMLElement;
  backupStatus: HTMLElement;
  backupHint: HTMLElement;
  busyButtons: HTMLButtonElement[];
  notify: (msg: string) => void;
}

const states = new WeakMap<HTMLElement, ViewState>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function create<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function actionButton(doc: Document, label: string, action: string): HTMLButtonElement {
  const button = create(doc, 'button', undefined, label);
  button.type = 'button';
  button.dataset['action'] = action;
  return button;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local date as YYYYMMDD, for the backup file name. */
function localDateStamp(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

function disposeState(state: ViewState): void {
  state.disposed = true;
  state.removeListeners();
  for (const timer of state.timers) clearTimeout(timer);
  state.timers.clear();
  releaseThumbs(state);
}

function releaseThumbs(state: ViewState): void {
  for (const url of state.thumbUrls.values()) URL.revokeObjectURL(url);
  state.thumbUrls.clear();
}

function setBusy(state: ViewState, busy: boolean): void {
  for (const button of state.busyButtons) button.disabled = busy;
}

// --- backup bar -----------------------------------------------------------------------------

async function refreshBackupBar(state: ViewState): Promise<void> {
  let last: string | null = null;
  try {
    last = await getLastBackupAt();
  } catch (error) {
    console.warn('[scenenote] could not read the last backup time', error);
  }
  if (state.disposed) return;

  const now = state.deps.now();
  const lastMs = last === null ? Number.NaN : Date.parse(last);
  if (Number.isNaN(lastMs)) {
    state.backupStatus.textContent = '還沒備份過';
  } else {
    const days = Math.floor((now.getTime() - lastMs) / DAY_MS);
    const ago = days <= 0 ? '今天' : `${days} 天前`;
    state.backupStatus.textContent = `上次備份：${ago}`;
  }
  const reminder = needsBackupReminder(last, now);
  state.backupBar.classList.toggle('reminder', reminder);
  state.backupHint.hidden = !reminder;
}

async function runBackup(state: ViewState): Promise<void> {
  setBusy(state, true);
  try {
    const bytes = await exportAllBackup();
    const now = state.deps.now();
    const name = `scenenote-backup-${localDateStamp(now)}.zip`;
    downloadBytes(name, bytes, 'application/zip');
    await setLastBackupAt(now.toISOString());
    await refreshBackupBar(state);
    state.notify(`已備份，檔案是 ${name}`);
  } catch (error) {
    console.error('[scenenote] backup failed', error);
    state.notify(`備份失敗：${errorMessage(error)}`);
  } finally {
    setBusy(state, false);
  }
}

async function runRestore(state: ViewState, file: File): Promise<void> {
  setBusy(state, true);
  try {
    let message: string;
    let failed = false;
    try {
      const { written, skipped } = await restoreBackup(new Uint8Array(await file.arrayBuffer()));
      message = `已還原：寫入 ${written} 則，略過 ${skipped} 則`;
    } catch (error) {
      failed = true;
      if (error instanceof BackupFormatError) {
        console.warn('[scenenote] not a scenenote backup', error);
        message = MSG_NOT_A_BACKUP;
      } else {
        console.error('[scenenote] restore failed', error);
        message = `還原失敗：${errorMessage(error)}`;
      }
    }
    // After a failure some notes may still have been written, so the list is reloaded either way.
    // A successful restore is announced first so that a failing reload can still speak up.
    if (!failed) state.notify(message);
    await loadAndPaint(state, checkedIds(state));
    if (failed) state.notify(message);
  } finally {
    setBusy(state, false);
  }
}

// --- note list ------------------------------------------------------------------------------

async function loadThumb(
  state: ViewState,
  seq: number,
  note: Note,
  slot: HTMLElement,
): Promise<void> {
  let bytes: ArrayBuffer | undefined;
  try {
    bytes = await state.deps.getImage(note.id);
  } catch (error) {
    console.warn('[scenenote] could not read a note image', error);
  }
  if (state.disposed || seq !== state.loadSeq || !state.notes.has(note.id)) return;

  if (!bytes) {
    showNoImage(slot);
    return;
  }
  const doc = slot.ownerDocument;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  state.thumbUrls.set(note.id, url);
  const img = create(doc, 'img');
  img.src = url;
  img.alt = `${formatTime(note.timeMs)} 的畫面`;
  const zoom = create(doc, 'button', 'thumb-zoom');
  zoom.type = 'button';
  zoom.title = '放大檢視';
  zoom.setAttribute('aria-label', `放大 ${formatTime(note.timeMs)} 的畫面`);
  zoom.append(img);
  zoom.addEventListener('click', () => {
    openLightbox(state, url, state.notes.get(note.id) ?? note);
  });
  slot.replaceChildren(zoom);
}

/** The full-size view of a note's picture. Closes on Esc, the 關閉 button or a click anywhere. */
function createLightbox(doc: Document): HTMLDialogElement {
  const dialog = create(doc, 'dialog', 'lightbox');
  dialog.setAttribute('aria-label', '放大的畫面');
  const img = create(doc, 'img');
  const caption = create(doc, 'p', 'lightbox-caption');
  const close = create(doc, 'button', 'lightbox-close', '關閉');
  close.type = 'button';
  dialog.append(close, img, caption);
  dialog.addEventListener('click', () => closeLightbox(dialog));
  return dialog;
}

function openLightbox(state: ViewState, url: string, note: Note): void {
  const dialog = state.lightbox;
  const img = dialog.querySelector('img')!;
  const time = formatTime(note.timeMs);
  img.src = url;
  img.alt = `${time} 的畫面`;
  const subtitle = note.subtitle.trim();
  dialog.querySelector('.lightbox-caption')!.textContent = subtitle === '' ? time : `${time}　${subtitle}`;
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeLightbox(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === 'function') dialog.close();
  dialog.removeAttribute('open');
}

/** The grey 「沒有圖」 box. */
function showNoImage(slot: HTMLElement): void {
  slot.classList.add('thumb-empty');
  slot.textContent = '沒有圖';
}

/** Brings a group's 「全選」 box in line with its notes' boxes. */
function syncGroupSelect(group: HTMLElement): void {
  const all = group.querySelector<HTMLInputElement>('.group-select input');
  if (!all) return;
  const boxes = Array.from(group.querySelectorAll<HTMLInputElement>('input.note-select'));
  const checked = boxes.filter((box) => box.checked).length;
  all.checked = boxes.length > 0 && checked === boxes.length;
  all.indeterminate = checked > 0 && checked < boxes.length;
}

async function saveBody(
  state: ViewState,
  id: string,
  textarea: HTMLTextAreaElement,
): Promise<void> {
  const current = state.notes.get(id);
  if (!current) return;
  // Trailing spaces and blank lines would show up as empty blocks in the exports, so they are
  // never stored, and adding or removing only those is not a change.
  const body = textarea.value.trimEnd();
  if (body === current.body.trimEnd()) return;

  // Update the on-screen copy first: the export buttons must see what is on screen even while
  // the write is still running.
  const updated: Note = {
    ...current,
    body,
    updatedAt: state.deps.now().toISOString(),
  };
  state.notes.set(id, updated);
  state.pendingSaves++;
  try {
    await state.deps.putNote(updated);
  } catch (error) {
    console.error('[scenenote] could not save the note', error);
    // Roll back, so the next blur tries again.
    if (state.notes.get(id) === updated) state.notes.set(id, current);
    state.notify(`儲存失敗：${errorMessage(error)}`);
  } finally {
    state.pendingSaves--;
  }
}

/** Saves every box whose text differs from what is stored; the others are left alone. */
function flushDirtyBodies(state: ViewState): void {
  for (const textarea of state.groupsEl.querySelectorAll<HTMLTextAreaElement>('textarea.body')) {
    const id = textarea.closest<HTMLElement>('.note')?.dataset['noteId'];
    if (id !== undefined) void saveBody(state, id, textarea);
  }
}

async function removeNote(state: ViewState, article: HTMLElement, button: HTMLButtonElement) {
  const id = article.dataset['noteId'];
  if (id === undefined) return;
  button.disabled = true;
  try {
    await state.deps.deleteNote(id);
  } catch (error) {
    console.error('[scenenote] could not delete the note', error);
    state.notify(`刪除失敗：${errorMessage(error)}`);
    button.textContent = '刪除';
    button.classList.remove('confirming');
    button.disabled = false;
    return;
  }

  state.notes.delete(id);
  const url = state.thumbUrls.get(id);
  if (url !== undefined) {
    URL.revokeObjectURL(url);
    state.thumbUrls.delete(id);
  }
  const group = article.closest<HTMLElement>('.group');
  article.remove();
  if (group && group.querySelector('.note') === null) group.remove();
  else if (group) syncGroupSelect(group);
  if (state.groupsEl.querySelector('.group') === null) showEmpty(state);
}

function showEmpty(state: ViewState): void {
  state.groupsEl.replaceChildren(create(state.groupsEl.ownerDocument, 'p', 'empty', EMPTY_TEXT));
}

function buildNote(
  state: ViewState,
  seq: number,
  note: Note,
  loads: Promise<void>[],
): HTMLElement {
  const doc = state.groupsEl.ownerDocument;
  const time = formatTime(note.timeMs);
  const article = create(doc, 'article', 'note');
  article.dataset['noteId'] = note.id;

  const select = create(doc, 'input', 'note-select');
  select.type = 'checkbox';
  select.dataset['noteId'] = note.id;
  select.setAttribute('aria-label', `選取 ${time} 這則筆記`);
  select.addEventListener('change', () => {
    const group = article.closest<HTMLElement>('.group');
    if (group) syncGroupSelect(group);
  });

  const thumb = create(doc, 'div', 'thumb');
  if (note.image.source === 'none') showNoImage(thumb);
  else loads.push(loadThumb(state, seq, note, thumb));
  // The label sits beside the picture box: the box's content is replaced when the picture loads.
  const thumbColumn = create(doc, 'div', 'thumb-column');
  thumbColumn.append(thumb);
  if (note.image.source === 'trickplay') thumbColumn.append(create(doc, 'span', 'lowres', '低解析度'));

  const timeButton = create(doc, 'button', 'time', time);
  timeButton.type = 'button';
  timeButton.title = '跳到 Netflix 的這一刻';
  timeButton.addEventListener('click', () => {
    state.deps.jump(state.notes.get(note.id) ?? note);
  });

  const main = create(doc, 'div', 'note-main');
  main.append(timeButton);
  if (note.subtitle !== '') main.append(create(doc, 'blockquote', 'subtitle', note.subtitle));

  const body = create(doc, 'textarea', 'body');
  body.value = note.body;
  body.rows = 3;
  body.placeholder = '寫下你的心得';
  body.setAttribute('aria-label', `${time} 的心得`);
  // Save shortly after typing stops, not only on blur: closing the tab, reloading or quitting
  // Chrome never blurs the box.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelSave = () => {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    state.timers.delete(saveTimer);
    saveTimer = undefined;
  };
  body.addEventListener('input', () => {
    cancelSave();
    const timer = setTimeout(() => {
      state.timers.delete(timer);
      if (saveTimer === timer) saveTimer = undefined;
      void saveBody(state, note.id, body);
    }, SAVE_DEBOUNCE_MS);
    saveTimer = timer;
    state.timers.add(timer);
  });
  body.addEventListener('blur', () => {
    cancelSave();
    void saveBody(state, note.id, body);
  });
  main.append(body);

  const remove = create(doc, 'button', 'delete', '刪除');
  remove.type = 'button';
  let pending: ReturnType<typeof setTimeout> | undefined;
  remove.addEventListener('click', () => {
    if (pending === undefined) {
      remove.textContent = '確定刪除？';
      remove.classList.add('confirming');
      pending = setTimeout(() => {
        if (pending !== undefined) state.timers.delete(pending);
        pending = undefined;
        remove.textContent = '刪除';
        remove.classList.remove('confirming');
      }, CONFIRM_DELETE_MS);
      state.timers.add(pending);
      return;
    }
    clearTimeout(pending);
    state.timers.delete(pending);
    pending = undefined;
    void removeNote(state, article, remove);
  });
  const actions = create(doc, 'div', 'note-actions');
  actions.append(remove);
  main.append(actions);

  article.append(select, thumbColumn, main);
  return article;
}

function buildGroup(
  state: ViewState,
  seq: number,
  group: NoteGroup,
  loads: Promise<void>[],
): HTMLElement {
  const doc = state.groupsEl.ownerDocument;
  const section = create(doc, 'section', 'group');
  section.dataset['videoId'] = group.videoId;

  const all = create(doc, 'input');
  all.type = 'checkbox';
  all.setAttribute('aria-label', `全選：${group.heading}`);
  all.addEventListener('change', () => {
    all.indeterminate = false;
    for (const box of section.querySelectorAll<HTMLInputElement>('input.note-select')) {
      box.checked = all.checked;
    }
  });
  const selectAll = create(doc, 'label', 'group-select');
  selectAll.append(all, create(doc, 'span', undefined, '全選'));

  const head = create(doc, 'header', 'group-head');
  head.append(create(doc, 'h2', undefined, group.heading), selectAll);
  section.append(head);
  for (const note of group.notes) section.append(buildNote(state, seq, note, loads));
  return section;
}

/** The ids of the notes whose boxes are checked right now. */
function checkedIds(state: ViewState): Set<string> {
  const ids = new Set<string>();
  const boxes = state.groupsEl.querySelectorAll<HTMLInputElement>('input.note-select:checked');
  for (const box of boxes) {
    const id = box.dataset['noteId'];
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * (Re)reads the notes and redraws the groups; resolves once all thumbnails are in. Notes whose id
 * is in `keepChecked` come back with their box checked.
 */
async function loadAndPaint(
  state: ViewState,
  keepChecked: ReadonlySet<string> = new Set(),
): Promise<void> {
  const seq = ++state.loadSeq;
  let notes: Note[];
  try {
    notes = await state.deps.listNotes();
  } catch (error) {
    console.error('[scenenote] could not read the notes', error);
    state.notify(`讀取筆記失敗：${errorMessage(error)}`);
    return;
  }
  if (state.disposed || seq !== state.loadSeq) return;

  releaseThumbs(state);
  state.notes = new Map(notes.map((note) => [note.id, note]));
  const groups = groupNotes(notes);
  if (groups.length === 0) {
    showEmpty(state);
    return;
  }
  // Draw the whole list first and let the pictures arrive as they are read.
  const loads: Promise<void>[] = [];
  const sections = groups.map((group) => buildGroup(state, seq, group, loads));
  state.groupsEl.replaceChildren(...sections);
  if (keepChecked.size > 0) {
    for (const box of state.groupsEl.querySelectorAll<HTMLInputElement>('input.note-select')) {
      box.checked = keepChecked.has(box.dataset['noteId'] ?? '');
    }
    for (const section of sections) syncGroupSelect(section);
  }
  await Promise.all(loads);
}

// --- public API -----------------------------------------------------------------------------

/**
 * Builds the notebook page inside `root` (the previous content of `root` is discarded): backup
 * bar, status line, export toolbar, then the notes grouped by video. Resolves once the list and
 * the thumbnails are on screen. `options.selectedIds` come back checked (a redraw keeps the
 * user's selection).
 */
export async function renderNotebook(
  root: HTMLElement,
  deps: NotebookDeps,
  options: { selectedIds?: Iterable<string> } = {},
): Promise<void> {
  const previous = states.get(root);
  if (previous) disposeState(previous);

  const doc = root.ownerDocument;

  const backupStatus = create(doc, 'span', 'backup-status');
  const backupHint = create(doc, 'span', 'backup-hint', '建議現在備份');
  backupHint.hidden = true;
  const backupButton = actionButton(doc, '全部備份', 'backup');
  const restoreButton = actionButton(doc, '從備份還原', 'restore');
  const fileInput = create(doc, 'input');
  fileInput.type = 'file';
  fileInput.accept = '.zip';
  fileInput.hidden = true;
  const backupBar = create(doc, 'section', 'backup-bar');
  backupBar.append(backupStatus, backupHint, backupButton, restoreButton, fileInput);

  const statusLine = create(doc, 'p', 'status');
  statusLine.setAttribute('role', 'status');
  statusLine.setAttribute('aria-live', 'polite');

  const toolbar = create(doc, 'div', 'toolbar');
  toolbar.id = 'export-actions';
  const groupsEl = create(doc, 'div', 'groups');
  const lightbox = createLightbox(doc);

  const state: ViewState = {
    deps,
    notes: new Map(),
    thumbUrls: new Map(),
    timers: new Set(),
    loadSeq: 0,
    pendingSaves: 0,
    disposed: false,
    removeListeners: () => {},
    groupsEl,
    lightbox,
    backupBar,
    backupStatus,
    backupHint,
    busyButtons: [backupButton, restoreButton],
    notify: (msg) => {
      statusLine.textContent = msg;
    },
  };
  states.set(root, state);

  // A closing page gets no blur and no time for the debounce: write what is typed right away.
  const win = doc.defaultView;
  const onPageHide = () => flushDirtyBodies(state);
  const onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') flushDirtyBodies(state);
  };
  win?.addEventListener('pagehide', onPageHide);
  doc.addEventListener('visibilitychange', onVisibilityChange);
  state.removeListeners = () => {
    win?.removeEventListener('pagehide', onPageHide);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
  };

  backupButton.addEventListener('click', () => {
    void runBackup(state);
  });
  restoreButton.addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    // Clear the input so choosing the same file again still fires `change`.
    fileInput.value = '';
    if (file) void runRestore(state, file);
  });

  root.replaceChildren(backupBar, statusLine, toolbar, groupsEl, lightbox);

  const exportDeps = {
    getSelectedNotes: () => getSelectedNotes(root),
    getImage: (id: string) => state.deps.getImage(id),
    notify: state.notify,
  };
  mountExportFileActions(toolbar, exportDeps);
  mountCardActions(toolbar, exportDeps);

  await Promise.all([
    refreshBackupBar(state),
    loadAndPaint(state, new Set(options.selectedIds ?? [])),
  ]);
}

/**
 * Shows `message` on the status line of the notebook drawn in `root`. `false` if `root` was never
 * rendered.
 */
export function notifyNotebook(root: HTMLElement, message: string): boolean {
  const state = states.get(root);
  if (!state) return false;
  state.notify(message);
  return true;
}

/** The notes whose boxes are checked, in on-screen order, with any edits already applied. */
export function getSelectedNotes(root: HTMLElement): Note[] {
  const state = states.get(root);
  if (!state) return [];
  const selected: Note[] = [];
  for (const box of root.querySelectorAll<HTMLInputElement>('input.note-select:checked')) {
    const note = state.notes.get(box.dataset['noteId'] ?? '');
    if (note) selected.push(note);
  }
  return selected;
}

/**
 * `id@updatedAt` of every note, sorted: changes when a note is added, removed or edited, and
 * only then.
 */
export function notesSignature(notes: Iterable<Pick<Note, 'id' | 'updatedAt'>>): string {
  return Array.from(notes, (note) => `${note.id}@${note.updatedAt}`)
    .sort()
    .join('|');
}

/**
 * The signature of what `root` shows right now. It follows the view's own state, so edits,
 * deletes and restores made in the page are already part of it. `null` if `root` was never
 * rendered.
 */
export function shownSignature(root: HTMLElement): string | null {
  const state = states.get(root);
  return state ? notesSignature(state.notes.values()) : null;
}

/**
 * True while the user is in the middle of writing: a body write is still running, a textarea has
 * focus, or a textarea holds text that has not been saved yet. A redraw would lose that text.
 */
export function hasPendingEdits(root: HTMLElement): boolean {
  const state = states.get(root);
  if (!state) return false;
  if (state.pendingSaves > 0) return true;
  const active = root.ownerDocument.activeElement;
  if (active?.tagName === 'TEXTAREA' && root.contains(active)) return true;
  for (const textarea of root.querySelectorAll<HTMLTextAreaElement>('textarea.body')) {
    const id = textarea.closest<HTMLElement>('.note')?.dataset['noteId'];
    const note = id === undefined ? undefined : state.notes.get(id);
    if (note && textarea.value.trimEnd() !== note.body.trimEnd()) return true;
  }
  return false;
}
