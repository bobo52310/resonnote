import { beforeEach, describe, expect, it } from 'vitest';
import { extractSubtitle } from '../../../src/platforms/youtube/subtitle';

/** One caption window the way YouTube renders it (measured on youtube.com, 2026-10-29). */
function captionWindow(position: 'bottom' | 'top', lines: string[][], extra = ''): string {
  const visualLines = lines
    .map(
      (segments) =>
        `<span class="caption-visual-line">${segments
          .map((text) => `<span class="ytp-caption-segment">${text}</span>`)
          .join('')}</span>`,
    )
    .join('');
  return `<div class="caption-window ytp-caption-window-${position}"><span class="captions-text">${visualLines}</span>${extra}</div>`;
}

function player(...windows: string[]): string {
  return `<div id="movie_player"><div id="ytp-caption-window-container" class="ytp-caption-window-container">${windows.join('')}</div></div>`;
}

const SETTINGS_ICON = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractSubtitle', () => {
  it('reads a single line', () => {
    document.body.innerHTML = player(captionWindow('bottom', [['So I have a procrastination problem.']]));
    expect(extractSubtitle(document)).toBe('So I have a procrastination problem.');
  });

  it('joins the segments of a line as they are and the lines with one space', () => {
    document.body.innerHTML = player(
      captionWindow('bottom', [['and then ', 'I woke up'], ['  in the middle\n of the night']]),
    );
    expect(extractSubtitle(document)).toBe('and then I woke up in the middle of the night');
  });

  it('joins several caption windows with one space', () => {
    document.body.innerHTML = player(
      captionWindow('top', [['(applause)']]),
      captionWindow('bottom', [['Thank you.'], ['Thank you very much.']]),
    );
    expect(extractSubtitle(document)).toBe('(applause) Thank you. Thank you very much.');
  });

  it('skips the window that names the caption language (it holds a settings icon)', () => {
    document.body.innerHTML = player(
      captionWindow('top', [['英文']], SETTINGS_ICON),
      captionWindow('bottom', [['Hello again.']]),
    );
    expect(extractSubtitle(document)).toBe('Hello again.');
  });

  it('is empty when the only window is the language label', () => {
    document.body.innerHTML = player(captionWindow('top', [['英文']], SETTINGS_ICON));
    expect(extractSubtitle(document)).toBe('');
  });

  it('ignores blank lines and windows', () => {
    document.body.innerHTML = player(
      captionWindow('top', [['  ']]),
      captionWindow('bottom', [[''], ['Real line']]),
    );
    expect(extractSubtitle(document)).toBe('Real line');
  });

  it('is empty when there are no captions at all', () => {
    document.body.innerHTML = player();
    expect(extractSubtitle(document)).toBe('');
    document.body.innerHTML = '<p>nothing</p>';
    expect(extractSubtitle(document)).toBe('');
  });

  it('falls back to Language Reactor and removes the pinyin', () => {
    document.body.innerHTML =
      player(captionWindow('bottom', [['']])) +
      `<div id="lln-main-subs"><div class="lln-subs-text">
        <span class="lln-word">而<span class="translit">ér</span></span>
        <span class="lln-word">...</span>
        <span class="lln-word">二<span class="translit">èr</span></span>
        <span class="lln-word">樓<span class="translit">lóu</span></span>
      </div></div>`;
    expect(extractSubtitle(document)).toBe('而二樓');
  });

  it('falls back to Language Reactor when only the language label is showing', () => {
    document.body.innerHTML =
      player(captionWindow('top', [['英文']], SETTINGS_ICON)) +
      '<div id="lln-main-subs"><div class="lln-subs-text"><span class="lln-word">Hola</span></div></div>';
    expect(extractSubtitle(document)).toBe('Hola');
  });

  it('prefers the native captions over Language Reactor', () => {
    document.body.innerHTML =
      player(captionWindow('bottom', [['native']])) +
      '<div id="lln-main-subs"><div class="lln-subs-text">ignored</div></div>';
    expect(extractSubtitle(document)).toBe('native');
  });

  it('reads only inside the scope when one is given (the idle player of a Shorts page)', () => {
    document.body.innerHTML = `
      <div id="movie_player">${captionWindow('bottom', [['from the idle player']])}</div>
      <div id="shorts-player">${captionWindow('bottom', [['from the shorts player']])}</div>`;
    const shorts = document.getElementById('shorts-player')!;
    expect(extractSubtitle(document, shorts)).toBe('from the shorts player');
  });

  it('does not modify the page', () => {
    document.body.innerHTML = player(captionWindow('top', [['英文']], SETTINGS_ICON));
    const before = document.body.innerHTML;
    extractSubtitle(document);
    expect(document.body.innerHTML).toBe(before);
  });
});
