import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBytes } from '../../src/export/download';

let created: Blob[];

beforeEach(() => {
  vi.useFakeTimers();
  created = [];
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    created.push(blob as Blob);
    return 'blob:fake-1';
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('downloadBytes', () => {
  it('clicks a temporary download link with the file name, then cleans up', async () => {
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = this;
    });

    downloadBytes('筆記-notes.zip', new Uint8Array([1, 2, 3]), 'application/zip');

    expect(clicked?.download).toBe('筆記-notes.zip');
    expect(clicked?.href).toBe('blob:fake-1');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(created[0]?.type).toBe('application/zip');
    expect(created[0]?.size).toBe(3);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
  });

  it('accepts a string payload', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBytes('a.html', '<p>你好</p>', 'text/html;charset=utf-8');
    expect(created[0]?.size).toBe(new TextEncoder().encode('<p>你好</p>').length);
  });

  it('accepts a Blob payload and gives it the stated type', () => {
    let clicked: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked = this;
    });
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2])], { type: '' });

    downloadBytes('card.png', png, 'image/png');

    expect(clicked?.download).toBe('card.png');
    expect(created[0]?.size).toBe(6);
    expect(created[0]?.type).toBe('image/png');
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-1');
  });
});
