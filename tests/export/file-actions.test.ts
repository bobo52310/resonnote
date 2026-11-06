import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '../../src/core/types';

vi.mock('../../src/export/download', () => ({ downloadBytes: vi.fn() }));
vi.mock('../../src/export/image', () => ({
  downscaleJpeg: vi.fn(async () => 'data:image/jpeg;base64,SMALL'),
}));

import { strFromU8, unzipSync } from 'fflate';
import { mountExportFileActions } from '../../src/export/file-actions';
import { downloadBytes } from '../../src/export/download';
import { downscaleJpeg } from '../../src/export/image';

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '83053998',
    title: '造山者－世紀的賭注',
    timeMs: 1003469,
    subtitle: '一句字幕',
    body: '心得文字',
    image: { source: 'tab', width: 1280, height: 720 },
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...overrides,
  };
}

let toolbar: HTMLElement;
let selected: Note[];
let notify: ReturnType<typeof vi.fn<(msg: string) => void>>;
let getImage: ReturnType<typeof vi.fn<(id: string) => Promise<ArrayBuffer | undefined>>>;

function lastDownload(): { name: string; data: Uint8Array | string | Blob; mime: string } {
  const call = vi.mocked(downloadBytes).mock.calls.at(-1);
  if (!call) throw new Error('nothing was downloaded');
  return { name: call[0], data: call[1], mime: call[2] };
}

function zipEntry(zip: Uint8Array | string | Blob, path: string): Uint8Array {
  if (typeof zip === 'string' || zip instanceof Blob) throw new Error('expected zip bytes');
  const found = unzipSync(zip)[path];
  if (!found) throw new Error(`missing zip entry: ${path}`);
  return found;
}

function zipPaths(zip: Uint8Array | string | Blob): string[] {
  if (typeof zip === 'string' || zip instanceof Blob) throw new Error('expected zip bytes');
  return Object.keys(unzipSync(zip)).sort();
}

function button(label: string): HTMLButtonElement {
  const found = [...toolbar.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  toolbar = document.createElement('div');
  document.body.append(toolbar);
  selected = [];
  notify = vi.fn();
  getImage = vi.fn(async () => undefined);
  mountExportFileActions(toolbar, {
    getSelectedNotes: () => selected,
    getImage,
    notify,
  });
});

afterEach(() => {
  toolbar.remove();
});

describe('mountExportFileActions', () => {
  it('appends the HTML and Markdown buttons to the toolbar', () => {
    const labels = [...toolbar.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['匯出網頁檔', '匯出 Markdown']);
  });

  it.each(['匯出網頁檔', '匯出 Markdown'])(
    'asks for a selection and downloads nothing when %s is clicked with none selected',
    async (label) => {
      button(label).click();
      await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('先勾選要匯出的筆記'));
      expect(notify).toHaveBeenCalledTimes(1);
      expect(downloadBytes).not.toHaveBeenCalled();
      expect(getImage).not.toHaveBeenCalled();
    },
  );

  it('downloads a Markdown zip named after the first selected note', async () => {
    selected = [makeNote('a')];
    getImage.mockResolvedValue(new Uint8Array([0xff, 0xd8, 1, 2]).buffer);

    button('匯出 Markdown').click();

    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const { name, data, mime } = lastDownload();
    expect(name).toBe('造山者－世紀的賭注-notes.zip');
    expect(name.endsWith('-notes.zip')).toBe(true);
    expect(mime).toBe('application/zip');
    expect(zipPaths(data)).toEqual(['images/a.jpg', 'notes.md']);
    expect(strFromU8(zipEntry(data, 'notes.md'))).toContain('![16:43](images/a.jpg)');
    expect(notify).not.toHaveBeenCalled();
  });

  it('treats a note whose stored image is gone as having no image', async () => {
    selected = [makeNote('a')];
    getImage.mockResolvedValue(undefined);

    button('匯出 Markdown').click();

    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    const { data } = lastDownload();
    expect(zipPaths(data)).toEqual(['notes.md']);
    expect(strFromU8(zipEntry(data, 'notes.md'))).not.toContain('![');
  });

  it('does not read images for notes captured without one', async () => {
    selected = [makeNote('a', { image: { source: 'none', width: 0, height: 0 } })];

    button('匯出 Markdown').click();

    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(getImage).not.toHaveBeenCalled();
  });

  it('downloads a single-file HTML page with images downscaled to 1280 px', async () => {
    selected = [makeNote('a'), makeNote('b', { timeMs: 5000, image: { source: 'none', width: 0, height: 0 } })];
    const buffer = new Uint8Array([0xff, 0xd8, 1, 2]).buffer;
    getImage.mockResolvedValue(buffer);

    button('匯出網頁檔').click();

    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(downscaleJpeg).toHaveBeenCalledTimes(1);
    expect(downscaleJpeg).toHaveBeenCalledWith(buffer, 1280);
    const { name, data, mime } = lastDownload();
    expect(name).toBe('造山者－世紀的賭注.html');
    expect(mime).toBe('text/html;charset=utf-8');
    expect(typeof data).toBe('string');
    expect(data as string).toContain('data:image/jpeg;base64,SMALL');
    expect((data as string).split('<article').length - 1).toBe(2);
  });

  it('still exports when an image cannot be downscaled', async () => {
    selected = [makeNote('a')];
    getImage.mockResolvedValue(new Uint8Array([1]).buffer);
    vi.mocked(downscaleJpeg).mockRejectedValueOnce(new Error('decode failed'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    button('匯出網頁檔').click();

    await vi.waitFor(() => expect(downloadBytes).toHaveBeenCalledTimes(1));
    expect(lastDownload().data as string).not.toContain('<img');
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[resonnote\]/);
    warn.mockRestore();
  });

  it('tells the user when the export fails', async () => {
    selected = [makeNote('a')];
    getImage.mockRejectedValue(new Error('db closed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    button('匯出 Markdown').click();

    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('匯出失敗，請再試一次'));
    expect(downloadBytes).not.toHaveBeenCalled();
    expect(String(error.mock.calls[0]?.[0])).toMatch(/^\[resonnote\]/);
    error.mockRestore();
  });
});
