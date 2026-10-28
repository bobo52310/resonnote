import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mountCardActions } from '../../src/export/card-actions';
import type { Note } from '../../src/core/types';

function makeNote(id: string): Note {
  return {
    id,
    platform: 'netflix',
    videoId: '81234567',
    title: '黑暗榮耀',
    season: 1,
    episode: 3,
    timeMs: 1003469,
    subtitle: '你好嗎',
    body: '心得',
    image: { source: 'tab', width: 1920, height: 1080 },
    createdAt: '2026-10-28T00:00:00.000Z',
    updatedAt: '2026-10-28T00:00:00.000Z',
  };
}

let toolbar: HTMLElement;
let selected: Note[];
let notify: Mock<(msg: string) => void>;
let getImage: Mock<(id: string) => Promise<ArrayBuffer | undefined>>;

function mount(): void {
  mountCardActions(toolbar, {
    getSelectedNotes: () => selected,
    getImage,
    notify,
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(toolbar.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

beforeEach(() => {
  toolbar = document.createElement('div');
  selected = [];
  notify = vi.fn();
  getImage = vi.fn(async () => undefined);
});

describe('mountCardActions', () => {
  it('appends the copy and download buttons to the toolbar', () => {
    mount();
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['複製圖卡', '下載圖卡']);
    for (const b of buttons) expect(b.type).toBe('button');
  });

  it('asks to select a note when copying with nothing selected', async () => {
    mount();
    button('複製圖卡').click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('先勾選要匯出的筆記'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getImage).not.toHaveBeenCalled();
  });

  it('refuses to copy more than one card at a time', async () => {
    selected = [makeNote('a'), makeNote('b')];
    mount();
    button('複製圖卡').click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('複製圖卡一次只能選一則'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getImage).not.toHaveBeenCalled();
  });

  it('asks to select a note when downloading with nothing selected', async () => {
    mount();
    button('下載圖卡').click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('先勾選要匯出的筆記'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(getImage).not.toHaveBeenCalled();
  });
});
