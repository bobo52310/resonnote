import { unzipSync, strFromU8 } from 'fflate';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createBackupZip, getLastBackupAt, setLastBackupAt } from '../../src/core/backup';
import {
  closeDb,
  deleteNote,
  getImage,
  getNote,
  listNotes,
  putImage,
  putNote,
} from '../../src/core/db';
import type { Note } from '../../src/core/types';
import { downloadBytes } from '../../src/export/download';
import {
  getSelectedNotes,
  hasPendingEdits,
  notifyNotebook,
  renderNotebook,
  type NotebookDeps,
} from '../../src/notebook/view';

vi.mock('../../src/export/download', () => ({ downloadBytes: vi.fn() }));

const NOW = new Date('2026-10-28T12:00:00.000Z');
const DAY = 86_400_000;
const EMPTY_TEXT = '還沒有筆記。在 Netflix 播放時按 ⌥⇧N 記下第一則。';

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

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

/** Deps backed by plain mocks, for tests that do not need a real database. */
function mockDeps(notes: Note[] = [], overrides: Partial<NotebookDeps> = {}) {
  const deps = {
    listNotes: vi.fn(async () => notes),
    putNote: vi.fn(async (_n: Note) => {}),
    deleteNote: vi.fn(async (_id: string) => {}),
    getImage: vi.fn(async (_id: string): Promise<ArrayBuffer | undefined> => undefined),
    jump: vi.fn((_n: Note) => {}),
    now: () => NOW,
    ...overrides,
  };
  return deps satisfies NotebookDeps;
}

/** Deps backed by the real (fake-indexeddb) database. */
function realDeps(overrides: Partial<NotebookDeps> = {}) {
  return mockDeps([], {
    listNotes,
    putNote: vi.fn(putNote),
    deleteNote: vi.fn(deleteNote),
    getImage,
    ...overrides,
  });
}

let root: HTMLElement;

function q<T extends Element = HTMLElement>(selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`not found: ${selector}`);
  return found;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text);
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function noteEl(id: string): HTMLElement {
  return q(`[data-note-id="${id}"]`);
}

function checkbox(id: string): HTMLInputElement {
  return q<HTMLInputElement>(`input.note-select[data-note-id="${id}"]`);
}

function setChecked(input: HTMLInputElement, checked: boolean): void {
  input.checked = checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function status(): string {
  return q('[role="status"]').textContent ?? '';
}

/** Lets pending promise callbacks run without touching fake timers. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function jpegBuffer(): ArrayBuffer {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;
}

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
  fakeBrowser.reset();
  vi.mocked(downloadBytes).mockClear();
  let urlCount = 0;
  URL.createObjectURL = vi.fn(() => `blob:thumb-${++urlCount}`);
  URL.revokeObjectURL = vi.fn();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('notifyNotebook', () => {
  it('shows a message on the status line of a rendered notebook', async () => {
    await renderNotebook(root, mockDeps([makeNote('a')]));
    expect(notifyNotebook(root, '跳回失敗：x')).toBe(true);
    expect(status()).toBe('跳回失敗：x');
  });

  it('follows a redraw of the notebook into its new status line', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    await renderNotebook(root, deps);
    expect(notifyNotebook(root, '之後的訊息')).toBe(true);
    expect(root.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(status()).toBe('之後的訊息');
  });

  it('reports false for an element that was never rendered', () => {
    expect(notifyNotebook(document.createElement('div'), 'x')).toBe(false);
  });
});

describe('page structure', () => {
  it('shows the empty state when there are no notes', async () => {
    await renderNotebook(root, mockDeps([]));
    expect(root.textContent).toContain(EMPTY_TEXT);
    expect(root.querySelectorAll('.group')).toHaveLength(0);
  });

  it('keeps the export toolbar, the status line and the backup bar even when empty', async () => {
    await renderNotebook(root, mockDeps([]));
    const toolbar = q('#export-actions');
    const labels = Array.from(toolbar.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['匯出網頁檔', '匯出 Markdown', '複製圖卡', '下載圖卡']);
    const live = q('[role="status"]');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(buttonByText('全部備份')).toBeTruthy();
    expect(buttonByText('從備份還原')).toBeTruthy();
  });

  it('puts the backup bar, then the status line, then the toolbar, then the groups', async () => {
    await renderNotebook(root, mockDeps([makeNote('a')]));
    const order = ['.backup-bar', '[role="status"]', '#export-actions', '.group'].map((sel) => {
      const el = q(sel);
      return { sel, el };
    });
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1]!.el;
      const next = order[i]!.el;
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('renders again into the same root without duplicating anything', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    await renderNotebook(root, deps);
    expect(root.querySelectorAll('#export-actions')).toHaveLength(1);
    expect(root.querySelectorAll('#export-actions button')).toHaveLength(4);
    expect(root.querySelectorAll('.group')).toHaveLength(1);
  });
});

describe('backup bar', () => {
  it('says 還沒備份過 and uses the reminder style when there was never a backup', async () => {
    await renderNotebook(root, mockDeps([]));
    expect(q('.backup-bar').textContent).toContain('還沒備份過');
    expect(q('.backup-bar').classList.contains('reminder')).toBe(true);
  });

  it('shows how many days ago the last backup was, without a reminder when recent', async () => {
    await setLastBackupAt(isoDaysAgo(3));
    await renderNotebook(root, mockDeps([]));
    expect(q('.backup-status').textContent).toBe('上次備份：3 天前');
    expect(q('.backup-bar').classList.contains('reminder')).toBe(false);
  });

  it('says 今天 for a backup made less than a day ago', async () => {
    await setLastBackupAt(isoDaysAgo(0.2));
    await renderNotebook(root, mockDeps([]));
    expect(q('.backup-status').textContent).toBe('上次備份：今天');
  });

  it('keeps the plain style at exactly 14 days and reminds beyond it', async () => {
    await setLastBackupAt(isoDaysAgo(14));
    await renderNotebook(root, mockDeps([]));
    expect(q('.backup-bar').classList.contains('reminder')).toBe(false);

    await setLastBackupAt(isoDaysAgo(15));
    await renderNotebook(root, mockDeps([]));
    expect(q('.backup-status').textContent).toBe('上次備份：15 天前');
    expect(q('.backup-bar').classList.contains('reminder')).toBe(true);
  });
});

describe('grouping and note rows', () => {
  it('renders one group per video with its heading and notes in time order', async () => {
    const notes = [
      makeNote('late', { timeMs: 900_000 }),
      makeNote('early', { timeMs: 5_000 }),
      makeNote('other', { videoId: '999', title: '另一部', season: undefined, episode: undefined }),
    ];
    await renderNotebook(root, mockDeps(notes));
    const groups = Array.from(root.querySelectorAll('.group'));
    expect(groups).toHaveLength(2);
    const first = groups.find((g) => g.querySelector('h2')?.textContent === '黑暗榮耀 第1季第3集');
    expect(first).toBeTruthy();
    const ids = Array.from(first!.querySelectorAll('.note')).map((n) => (n as HTMLElement).dataset['noteId']);
    expect(ids).toEqual(['early', 'late']);
    expect(groups.some((g) => g.querySelector('h2')?.textContent === '另一部')).toBe(true);
  });

  it('shows time, subtitle and body of a note', async () => {
    await renderNotebook(root, mockDeps([makeNote('a')]));
    const el = noteEl('a');
    expect(el.querySelector('.time')?.textContent).toBe('16:43');
    expect(el.querySelector('.subtitle')?.textContent).toBe('你好嗎');
    expect(el.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('原本的心得');
  });

  it('omits the subtitle block when the note has no subtitle', async () => {
    await renderNotebook(root, mockDeps([makeNote('a', { subtitle: '' })]));
    expect(noteEl('a').querySelector('.subtitle')).toBeNull();
  });

  it('calls deps.jump with the note when the time is clicked', async () => {
    const note = makeNote('a');
    const deps = mockDeps([note]);
    await renderNotebook(root, deps);
    noteEl('a').querySelector<HTMLButtonElement>('.time')!.click();
    expect(deps.jump).toHaveBeenCalledTimes(1);
    expect(deps.jump).toHaveBeenCalledWith(note);
  });
});

describe('thumbnails', () => {
  it('shows the stored image through an object URL', async () => {
    const deps = mockDeps([makeNote('a')], { getImage: vi.fn(async () => jpegBuffer()) });
    await renderNotebook(root, deps);
    const img = noteEl('a').querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob:thumb-1');
    expect(noteEl('a').textContent).not.toContain('沒有圖');
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/jpeg');
  });

  it('shows the grey 沒有圖 placeholder when the image is missing from storage', async () => {
    // image.source says there should be a picture, but nothing is stored for it
    await renderNotebook(root, mockDeps([makeNote('a')]));
    expect(noteEl('a').querySelector('img')).toBeNull();
    expect(noteEl('a').querySelector('.thumb-empty')?.textContent).toBe('沒有圖');
  });

  it('shows the placeholder for a note captured without an image', async () => {
    const deps = mockDeps([makeNote('a', { image: { source: 'none', width: 0, height: 0 } })], {
      getImage: vi.fn(async () => jpegBuffer()),
    });
    await renderNotebook(root, deps);
    expect(noteEl('a').querySelector('.thumb-empty')?.textContent).toBe('沒有圖');
    expect(noteEl('a').querySelector('img')).toBeNull();
  });

  it('marks a scrubber-image note with 低解析度 next to its thumbnail', async () => {
    const note = makeNote('a', { image: { source: 'trickplay', width: 320, height: 180 } });
    await renderNotebook(root, mockDeps([note], { getImage: vi.fn(async () => jpegBuffer()) }));
    const label = noteEl('a').querySelector('.lowres');
    expect(label?.textContent).toBe('低解析度');
    // beside the picture, not inside the box the picture replaces itself in
    const thumb = noteEl('a').querySelector('.thumb')!;
    expect(label?.parentElement).toBe(thumb.parentElement);
    expect(thumb.contains(label)).toBe(false);
    expect(thumb.querySelector('img')).not.toBeNull();
  });

  it('keeps the 低解析度 label when the scrubber image itself is missing from storage', async () => {
    const note = makeNote('a', { image: { source: 'trickplay', width: 320, height: 180 } });
    await renderNotebook(root, mockDeps([note]));
    expect(noteEl('a').querySelector('.thumb-empty')?.textContent).toBe('沒有圖');
    expect(noteEl('a').querySelector('.lowres')?.textContent).toBe('低解析度');
  });

  it.each([['tab'], ['none']] as const)('has no 低解析度 label for a %s note', async (source) => {
    const note = makeNote('a', { image: { source, width: 1280, height: 720 } });
    await renderNotebook(root, mockDeps([note], { getImage: vi.fn(async () => jpegBuffer()) }));
    expect(noteEl('a').querySelector('.lowres')).toBeNull();
    expect(root.textContent).not.toContain('低解析度');
  });

  it('revokes the old object URLs when the page is rendered again', async () => {
    const deps = mockDeps([makeNote('a')], { getImage: vi.fn(async () => jpegBuffer()) });
    await renderNotebook(root, deps);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await renderNotebook(root, deps);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1');
    expect(noteEl('a').querySelector('img')?.getAttribute('src')).toBe('blob:thumb-2');
  });
});

describe('editing the body', () => {
  it('saves a changed body on blur with a fresh updatedAt, keeping the start as typed', async () => {
    const note = makeNote('a');
    const deps = mockDeps([note]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = '  新的心得\n第二行';
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
    expect(deps.putNote).toHaveBeenCalledWith({
      ...note,
      body: '  新的心得\n第二行',
      updatedAt: '2026-10-28T12:00:00.000Z',
    });
  });

  it('trims trailing spaces and blank lines off the body it saves', async () => {
    const note = makeNote('a');
    const deps = mockDeps([note]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = '新的心得  \n第二行 \n\n\n';
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(vi.mocked(deps.putNote).mock.calls[0]![0].body).toBe('新的心得  \n第二行');
    expect(getSelectedNotes(root)).toEqual([]);
    setChecked(checkbox('a'), true);
    expect(getSelectedNotes(root).map((n) => n.body)).toEqual(['新的心得  \n第二行']);
  });

  it('does not write when only trailing whitespace was added', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = '原本的心得  \n\n';
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).not.toHaveBeenCalled();
    expect(hasPendingEdits(root)).toBe(false);
  });

  it('does not rewrite an old note whose stored body has trailing whitespace just because its box was left', async () => {
    const deps = mockDeps([makeNote('a', { body: '舊心得 \n\n' })]);
    await renderNotebook(root, deps);
    noteEl('a').querySelector('textarea')!.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).not.toHaveBeenCalled();
  });

  it('saves an empty body when the text was cleared down to whitespace', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = ' \n ';
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(vi.mocked(deps.putNote).mock.calls[0]![0].body).toBe('');
  });

  it('does not save when the body did not change', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    noteEl('a').querySelector('textarea')!.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).not.toHaveBeenCalled();
  });

  it('does not save the same text twice', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = '改了';
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
  });

  it('lets the export buttons see the edited body right away', async () => {
    await renderNotebook(root, mockDeps([makeNote('a')]));
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = '剛改的';
    textarea.dispatchEvent(new Event('blur'));
    setChecked(checkbox('a'), true);
    expect(getSelectedNotes(root).map((n) => n.body)).toEqual(['剛改的']);
  });

  it('reports a failed save and tries again on the next blur', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const putNoteMock = vi.fn(async (_n: Note) => {});
    putNoteMock.mockRejectedValueOnce(new Error('disk full'));
    const deps = mockDeps([makeNote('a')], { putNote: putNoteMock });
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    textarea.value = '改了';
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(status()).toContain('儲存失敗');
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(2);
  });
});

describe('autosave while typing', () => {
  beforeEach(() => {
    // Only the timers the view uses: fake-indexeddb and promises keep running for real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  function type(textarea: HTMLTextAreaElement, value: string): void {
    textarea.value = value;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('saves about half a second after the last keystroke, without waiting for blur', async () => {
    const note = makeNote('a');
    const deps = mockDeps([note]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    type(textarea, '打到一半的心得');

    vi.advanceTimersByTime(499);
    await flush();
    expect(deps.putNote).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
    expect(deps.putNote).toHaveBeenCalledWith({
      ...note,
      body: '打到一半的心得',
      updatedAt: '2026-10-28T12:00:00.000Z',
    });
  });

  it('waits again after every keystroke and saves only the final text', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    type(textarea, '一');
    vi.advanceTimersByTime(400);
    type(textarea, '一二');
    vi.advanceTimersByTime(400);
    await flush();
    expect(deps.putNote).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.putNote).mock.calls[0]![0].body).toBe('一二');
  });

  it('does not save the same text again when the box is left after the autosave', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    type(textarea, '改了');
    vi.advanceTimersByTime(500);
    await flush();
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    vi.advanceTimersByTime(1000);
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
  });

  it('saves on blur at once and drops the waiting autosave', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const textarea = noteEl('a').querySelector('textarea')!;
    type(textarea, '馬上存');
    textarea.dispatchEvent(new Event('blur'));
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(1);
  });

  it('flushes every dirty box at once when the page is hidden (pagehide)', async () => {
    const deps = mockDeps([makeNote('a', { timeMs: 1 }), makeNote('b', { timeMs: 2 }), makeNote('c', { timeMs: 3 })]);
    await renderNotebook(root, deps);
    type(noteEl('a').querySelector('textarea')!, 'A 的新心得');
    type(noteEl('c').querySelector('textarea')!, 'C 的新心得');
    expect(deps.putNote).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('pagehide'));
    await flush();

    const saved = vi.mocked(deps.putNote).mock.calls.map(([n]) => [n.id, n.body]);
    expect(saved).toEqual([
      ['a', 'A 的新心得'],
      ['c', 'C 的新心得'],
    ]);
    // the timers that were still waiting find nothing left to do
    vi.advanceTimersByTime(1000);
    await flush();
    expect(deps.putNote).toHaveBeenCalledTimes(2);
  });

  it('flushes a dirty box when the tab becomes hidden (visibilitychange)', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    type(noteEl('a').querySelector('textarea')!, '切走之前');

    const state = vi.spyOn(document, 'visibilityState', 'get');
    try {
      state.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await flush();
      expect(deps.putNote).not.toHaveBeenCalled();

      state.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await flush();
      expect(deps.putNote).toHaveBeenCalledTimes(1);
      expect(vi.mocked(deps.putNote).mock.calls[0]![0].body).toBe('切走之前');
    } finally {
      state.mockRestore();
    }
  });

  it('stops listening for pagehide of an older drawing once the page is rendered again', async () => {
    const oldDeps = mockDeps([makeNote('a')]);
    await renderNotebook(root, oldDeps);
    type(noteEl('a').querySelector('textarea')!, '舊畫面裡的字');

    const newDeps = mockDeps([makeNote('a')]);
    await renderNotebook(root, newDeps);
    window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(oldDeps.putNote).not.toHaveBeenCalled();
    expect(newDeps.putNote).not.toHaveBeenCalled();
  });

  it('counts a box with unsaved text as pending edits until the autosave lands', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    type(noteEl('a').querySelector('textarea')!, '還沒存');
    expect(hasPendingEdits(root)).toBe(true);
    vi.advanceTimersByTime(500);
    await flush();
    expect(hasPendingEdits(root)).toBe(false);
  });
});

describe('deleting', () => {
  beforeEach(() => {
    // Only the timers the view uses: fake-indexeddb and promises keep running for real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('needs two presses: the first only asks for confirmation', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const button = noteEl('a').querySelector<HTMLButtonElement>('.delete')!;
    expect(button.textContent).toBe('刪除');
    button.click();
    expect(button.textContent).toBe('確定刪除？');
    expect(deps.deleteNote).not.toHaveBeenCalled();
    button.click();
    await flush();
    expect(deps.deleteNote).toHaveBeenCalledTimes(1);
    expect(deps.deleteNote).toHaveBeenCalledWith('a');
  });

  it('goes back to 刪除 after 3 seconds, so the next press asks again', async () => {
    const deps = mockDeps([makeNote('a')]);
    await renderNotebook(root, deps);
    const button = noteEl('a').querySelector<HTMLButtonElement>('.delete')!;
    button.click();
    vi.advanceTimersByTime(2900);
    expect(button.textContent).toBe('確定刪除？');
    vi.advanceTimersByTime(200);
    expect(button.textContent).toBe('刪除');
    button.click();
    await flush();
    expect(deps.deleteNote).not.toHaveBeenCalled();
    expect(button.textContent).toBe('確定刪除？');
  });

  it('removes the note, its selection and its object URL; the last note brings back the empty state', async () => {
    const notes = [makeNote('a', { timeMs: 1000 }), makeNote('b', { timeMs: 2000 })];
    const deps = mockDeps(notes, { getImage: vi.fn(async () => jpegBuffer()) });
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);

    const a = noteEl('a').querySelector<HTMLButtonElement>('.delete')!;
    a.click();
    a.click();
    await flush();
    expect(root.querySelector('[data-note-id="a"]')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:thumb-1');
    expect(getSelectedNotes(root)).toEqual([]);
    expect(root.querySelectorAll('.group')).toHaveLength(1);

    const b = noteEl('b').querySelector<HTMLButtonElement>('.delete')!;
    b.click();
    b.click();
    await flush();
    expect(root.querySelectorAll('.group')).toHaveLength(0);
    expect(root.textContent).toContain(EMPTY_TEXT);
  });

  it('keeps the note and says so when the delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deleteNoteMock = vi.fn(async (_id: string) => {});
    deleteNoteMock.mockRejectedValueOnce(new Error('locked'));
    const deps = mockDeps([makeNote('a')], { deleteNote: deleteNoteMock });
    await renderNotebook(root, deps);
    const button = noteEl('a').querySelector<HTMLButtonElement>('.delete')!;
    button.click();
    button.click();
    await flush();
    expect(root.querySelector('[data-note-id="a"]')).not.toBeNull();
    expect(status()).toContain('刪除失敗');
    expect(button.textContent).toBe('刪除');
    expect(button.disabled).toBe(false);
  });
});

describe('selection', () => {
  it('returns checked notes in on-screen order, not the order they were checked in', async () => {
    const notes = [
      makeNote('late', { timeMs: 900_000 }),
      makeNote('early', { timeMs: 5_000 }),
      makeNote('other', { videoId: '999', title: '另一部', createdAt: '2026-10-01T00:00:00.000Z' }),
    ];
    await renderNotebook(root, mockDeps(notes));
    setChecked(checkbox('other'), true);
    setChecked(checkbox('late'), true);
    setChecked(checkbox('early'), true);
    // groups: the video with the newest note first (early/late), then 'other'
    expect(getSelectedNotes(root).map((n) => n.id)).toEqual(['early', 'late', 'other']);
  });

  it('returns the Note objects, not copies rebuilt from the DOM', async () => {
    const note = makeNote('a');
    await renderNotebook(root, mockDeps([note]));
    setChecked(checkbox('a'), true);
    expect(getSelectedNotes(root)).toEqual([note]);
  });

  it('is empty before anything is checked and for an element that was never rendered', async () => {
    await renderNotebook(root, mockDeps([makeNote('a')]));
    expect(getSelectedNotes(root)).toEqual([]);
    expect(getSelectedNotes(document.createElement('div'))).toEqual([]);
  });

  it('checks and unchecks a whole group with its 全選', async () => {
    const notes = [
      makeNote('a', { timeMs: 1000 }),
      makeNote('b', { timeMs: 2000 }),
      makeNote('c', { videoId: '999', title: '另一部' }),
    ];
    await renderNotebook(root, mockDeps(notes));
    const group = noteEl('a').closest('.group')!;
    const all = group.querySelector<HTMLInputElement>('.group-select input')!;
    expect(group.querySelector('.group-select')?.textContent).toContain('全選');

    setChecked(all, true);
    expect(getSelectedNotes(root).map((n) => n.id).sort()).toEqual(['a', 'b']);
    setChecked(all, false);
    expect(getSelectedNotes(root)).toEqual([]);
  });

  it('keeps the 全選 box in step with the individual boxes', async () => {
    await renderNotebook(root, mockDeps([makeNote('a', { timeMs: 1 }), makeNote('b', { timeMs: 2 })]));
    const all = q<HTMLInputElement>('.group-select input');
    setChecked(checkbox('a'), true);
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
    setChecked(checkbox('b'), true);
    expect(all.checked).toBe(true);
    expect(all.indeterminate).toBe(false);
    setChecked(checkbox('a'), false);
    setChecked(checkbox('b'), false);
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
  });
});

describe('export buttons', () => {
  it('are wired to the selection and to the status line', async () => {
    await renderNotebook(root, mockDeps([makeNote('a')]));
    buttonByText('匯出網頁檔').click();
    await flush();
    expect(status()).toBe('先勾選要匯出的筆記');
    buttonByText('複製圖卡').click();
    await flush();
    expect(status()).toBe('先勾選要匯出的筆記');
  });

  it('offer the stored image of a selected note through getImage', async () => {
    const deps = realDeps();
    await putNote(makeNote('a'));
    await putImage('a', jpegBuffer());
    await renderNotebook(root, deps);
    setChecked(checkbox('a'), true);
    buttonByText('匯出 Markdown').click();
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const [name, data, mime] = vi.mocked(downloadBytes).mock.calls[0]!;
    expect(name).toMatch(/\.zip$/);
    expect(mime).toBe('application/zip');
    const files = unzipSync(data as Uint8Array);
    expect(Object.keys(files)).toContain('images/a.jpg');
  });
});

describe('backup', () => {
  it('downloads a dated zip, records the time and refreshes the bar', async () => {
    await putNote(makeNote('a'));
    await putImage('a', jpegBuffer());
    const deps = realDeps({ now: () => new Date(2026, 9, 28, 23, 30) });
    await renderNotebook(root, deps);
    expect(q('.backup-status').textContent).toBe('還沒備份過');

    buttonByText('全部備份').click();
    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));

    const [name, data, mime] = vi.mocked(downloadBytes).mock.calls[0]!;
    expect(name).toBe('scenenote-backup-20261028.zip');
    expect(mime).toBe('application/zip');
    const files = unzipSync(data as Uint8Array);
    expect(Object.keys(files).sort()).toEqual(['images/a.jpg', 'notes.json']);
    expect(JSON.parse(strFromU8(files['notes.json']!)).notes).toHaveLength(1);

    await vi.waitFor(async () => expect(await getLastBackupAt()).not.toBeNull());
    await vi.waitFor(() => expect(q('.backup-status').textContent).toBe('上次備份：今天'));
    expect(q('.backup-bar').classList.contains('reminder')).toBe(false);
    expect(status()).toContain('已備份');
  });

  it('does not record a backup when building the zip fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(downloadBytes).mockImplementationOnce(() => {
      throw new Error('download blocked');
    });
    await renderNotebook(root, realDeps());
    buttonByText('全部備份').click();
    await vi.waitFor(() => expect(status()).toContain('備份失敗'));
    expect(await getLastBackupAt()).toBeNull();
    expect(q('.backup-status').textContent).toBe('還沒備份過');
  });

  it('opens the file picker, restricted to zip files, from 從備份還原', async () => {
    await renderNotebook(root, realDeps());
    const input = q<HTMLInputElement>('input[type="file"]');
    expect(input.accept).toBe('.zip');
    expect(input.hidden).toBe(true);
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    buttonByText('從備份還原').click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  async function chooseFile(bytes: Uint8Array): Promise<void> {
    const input = q<HTMLInputElement>('input[type="file"]');
    const file = new File([bytes.slice()], 'scenenote-backup.zip', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('restores a backup, reports the counts and shows the restored notes', async () => {
    await putNote(makeNote('keep', { timeMs: 1, updatedAt: '2026-10-27T00:00:00.000Z' }));
    const incoming = [
      makeNote('keep', { timeMs: 1, updatedAt: '2026-10-01T00:00:00.000Z', body: '舊的' }),
      makeNote('fresh', { timeMs: 2, body: '備份裡的新筆記' }),
    ];
    const zip = createBackupZip(incoming, new Map([['fresh', new Uint8Array([0xff, 0xd8, 1])]]));
    await renderNotebook(root, realDeps());
    expect(root.querySelectorAll('.note')).toHaveLength(1);

    await chooseFile(zip);
    await vi.waitFor(() => expect(status()).toBe('已還原：寫入 1 則，略過 1 則'));
    await vi.waitFor(() => expect(root.querySelectorAll('.note')).toHaveLength(2));
    expect(noteEl('fresh').querySelector('textarea')?.value).toBe('備份裡的新筆記');
    expect((await getNote('keep'))?.body).toBe('原本的心得');
    // the same file can be picked again
    expect(q<HTMLInputElement>('input[type="file"]').value).toBe('');
  });

  it('says the file is not a scenenote backup when it cannot be read as one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderNotebook(root, realDeps());
    await chooseFile(new TextEncoder().encode('this is not a zip'));
    await vi.waitFor(() => expect(status()).toBe('這不是 scenenote 的備份檔，或檔案已損壞'));
  });

  it('prefixes other failures with 還原失敗：', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const zip = createBackupZip([makeNote('a')], new Map());
    await renderNotebook(root, realDeps({ listNotes: vi.fn(async () => []) }));
    await closeDb();
    globalThis.indexedDB = {
      open() {
        throw new Error('storage unavailable');
      },
    } as unknown as IDBFactory;
    await chooseFile(zip);
    await vi.waitFor(() => expect(status()).toMatch(/^還原失敗：.*storage unavailable/));
  });
});
