import { beforeEach, describe, expect, it } from 'vitest';
import { hidePlayerUi as hide } from '../../src/core/hide-ui';

/** Netflix's keep list, as the Netflix adapter passes it. */
const KEEP = 'video, .player-timedtext, #lln-main-subs';
const hidePlayerUi = (root: Element) => hide(root, KEEP);

// Shaped like Netflix's player: the video and subtitles share a canvas, the controls are siblings.
const PLAYER = `
  <div class="watch-video">
    <div class="watch-video--player-view">
      <div data-uia="video-canvas">
        <div><video></video></div>
        <div class="player-timedtext"><span>你好嗎</span></div>
      </div>
      <div class="watch-video--back-container" style="opacity: 0.5">back</div>
      <div class="watch-video--bottom-controls-container">
        <div class="scrubber">scrubber</div>
        <div class="title">造山者</div>
      </div>
    </div>
  </div>
  <div id="lln-main-subs"><div class="lln-subs-text">字幕</div></div>
  <div id="other-page-thing">other</div>
`;

const byClass = (name: string) => document.querySelector<HTMLElement>(`.${name}`)!;
const opacity = (el: Element) => (el as HTMLElement).style.getPropertyValue('opacity');

beforeEach(() => {
  document.body.innerHTML = PLAYER;
});

describe('hidePlayerUi', () => {
  it('hides the controls and anything else on the page', () => {
    hidePlayerUi(document.body);
    expect(opacity(byClass('watch-video--bottom-controls-container'))).toBe('0');
    expect(byClass('watch-video--bottom-controls-container').style.getPropertyPriority('opacity')).toBe('important');
    expect(opacity(byClass('watch-video--back-container'))).toBe('0');
    expect(opacity(document.getElementById('other-page-thing')!)).toBe('0');
  });

  it('leaves the video, the subtitles and their ancestors untouched', () => {
    hidePlayerUi(document.body);
    for (const el of [
      document.querySelector('video')!,
      byClass('player-timedtext'),
      document.querySelector('[data-uia="video-canvas"]')!,
      byClass('watch-video--player-view'),
      byClass('watch-video'),
      document.getElementById('lln-main-subs')!,
      document.querySelector('video')!.parentElement!,
    ]) {
      expect(opacity(el)).toBe('');
    }
  });

  it('puts the original inline styles back', () => {
    const restore = hidePlayerUi(document.body);
    restore();
    expect(opacity(byClass('watch-video--back-container'))).toBe('0.5');
    expect(byClass('watch-video--back-container').style.getPropertyPriority('opacity')).toBe('');
    expect(opacity(byClass('watch-video--bottom-controls-container'))).toBe('');
    expect(byClass('watch-video--bottom-controls-container').hasAttribute('style')).toBe(false);
  });

  it('can be restored twice without harm', () => {
    const restore = hidePlayerUi(document.body);
    restore();
    byClass('watch-video--back-container').style.opacity = '0.7';
    restore();
    expect(opacity(byClass('watch-video--back-container'))).toBe('0.7');
  });

  it('only touches elements under the given root', () => {
    hidePlayerUi(byClass('watch-video--player-view'));
    expect(opacity(byClass('watch-video--bottom-controls-container'))).toBe('0');
    expect(opacity(document.getElementById('other-page-thing')!)).toBe('');
  });
});

describe('hidePlayerUi keep selector', () => {
  it('keeps whatever the caller names, and hides what it does not', () => {
    document.body.innerHTML = `
      <div id="player">
        <div class="stage"><video></video><div class="ytp-caption-window-container">字幕</div></div>
        <div class="ytp-chrome-bottom">bar</div>
        <div class="player-timedtext">not kept here</div>
      </div>`;
    const restore = hide(document.getElementById('player')!, 'video, .ytp-caption-window-container');
    expect(opacity(byClass('ytp-chrome-bottom'))).toBe('0');
    expect(opacity(byClass('player-timedtext'))).toBe('0');
    expect(opacity(byClass('stage'))).toBe('');
    expect(opacity(byClass('ytp-caption-window-container'))).toBe('');
    restore();
    expect(opacity(byClass('ytp-chrome-bottom'))).toBe('');
  });
});
