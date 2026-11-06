import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBytes } from '../../src/export/download';
import { saveFileAs } from '../../src/export/save-file';

vi.mock('../../src/export/download', () => ({ downloadBytes: vi.fn() }));

const FILE = {
  name: 'resonnote-backup-20261028.zip',
  mime: 'application/zip',
  extension: '.zip',
  description: 'ResonNote 備份',
};
const BYTES = new Uint8Array([0x50, 0x4b, 3, 4]);

/** Chrome's save dialog, as far as saveFileAs uses it. */
function fakeSaveDialog(answer: { chosen: string } | { error: unknown }) {
  const written: Blob[] = [];
  const writable = {
    write: vi.fn(async (data: Blob) => {
      written.push(data);
    }),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  const picker = vi.fn(async (_options: unknown) => {
    if ('error' in answer) throw answer.error;
    return { name: answer.chosen, createWritable: async () => writable };
  });
  Object.defineProperty(window, 'showSaveFilePicker', { value: picker, configurable: true, writable: true });
  return { picker, writable, written };
}

beforeEach(() => {
  vi.mocked(downloadBytes).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  Reflect.deleteProperty(window, 'showSaveFilePicker');
  vi.restoreAllMocks();
});

describe('saveFileAs', () => {
  it('opens the save dialog at once, makes the bytes only once a place is chosen, and writes them', async () => {
    const dialog = fakeSaveDialog({ chosen: '我的備份.zip' });
    const make = vi.fn(async () => BYTES);

    const pending = saveFileAs(FILE, make);
    // Still inside the click that asked for it: the dialog needs that user gesture.
    expect(dialog.picker).toHaveBeenCalledTimes(1);
    expect(make).not.toHaveBeenCalled();

    await expect(pending).resolves.toEqual({ status: 'saved', name: '我的備份.zip' });
    expect(dialog.picker).toHaveBeenCalledWith({
      suggestedName: FILE.name,
      types: [{ description: FILE.description, accept: { 'application/zip': ['.zip'] } }],
    });
    expect(make).toHaveBeenCalledTimes(1);
    expect(dialog.written).toHaveLength(1);
    expect(new Uint8Array(await dialog.written[0]!.arrayBuffer())).toEqual(BYTES);
    expect(dialog.writable.close).toHaveBeenCalledTimes(1);
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it('reports a cancelled dialog, without making or downloading anything', async () => {
    fakeSaveDialog({ error: new DOMException('The user aborted a request.', 'AbortError') });
    const make = vi.fn(async () => BYTES);
    await expect(saveFileAs(FILE, make)).resolves.toEqual({ status: 'cancelled' });
    expect(make).not.toHaveBeenCalled();
    expect(downloadBytes).not.toHaveBeenCalled();
  });

  it('hands the file to the downloads when there is no save dialog, and says it cannot know more', async () => {
    const make = vi.fn(async () => BYTES);
    await expect(saveFileAs(FILE, make)).resolves.toEqual({ status: 'downloading', name: FILE.name });
    expect(downloadBytes).toHaveBeenCalledWith(FILE.name, BYTES, FILE.mime);
  });

  it('falls back to the downloads when the dialog is refused for another reason', async () => {
    fakeSaveDialog({ error: new DOMException('Must be handling a user gesture.', 'SecurityError') });
    await expect(saveFileAs(FILE, async () => BYTES)).resolves.toEqual({
      status: 'downloading',
      name: FILE.name,
    });
    expect(downloadBytes).toHaveBeenCalledWith(FILE.name, BYTES, FILE.mime);
  });

  it('gives up the half-written file and fails when writing fails', async () => {
    const dialog = fakeSaveDialog({ chosen: 'x.zip' });
    dialog.writable.write.mockRejectedValueOnce(new Error('disk full'));
    await expect(saveFileAs(FILE, async () => BYTES)).rejects.toThrow('disk full');
    expect(dialog.writable.abort).toHaveBeenCalledTimes(1);
    expect(dialog.writable.close).not.toHaveBeenCalled();
  });

  it('fails without writing when the bytes cannot be made', async () => {
    const dialog = fakeSaveDialog({ chosen: 'x.zip' });
    await expect(
      saveFileAs(FILE, async () => {
        throw new Error('database gone');
      }),
    ).rejects.toThrow('database gone');
    expect(dialog.writable.write).not.toHaveBeenCalled();
  });
});
