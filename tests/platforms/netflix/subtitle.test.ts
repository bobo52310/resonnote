import { beforeEach, describe, expect, it } from 'vitest';
import { extractSubtitle } from '../../../src/platforms/netflix/subtitle';

describe('extractSubtitle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('prefers the native Netflix subtitle and collapses whitespace', () => {
    document.body.innerHTML = `
      <div class="player-timedtext">
        <div class="player-timedtext-text-container"><span>Hello,
          <br>world</span></div>
      </div>
      <div id="lln-main-subs"><div class="lln-subs-text">ignored</div></div>`;
    expect(extractSubtitle(document)).toBe('Hello, world');
  });

  it('falls back to Language Reactor and removes the pinyin', () => {
    document.body.innerHTML = `
      <div class="player-timedtext"></div>
      <div id="lln-main-subs"><div class="lln-subs-text">
        <span class="tt"><span class="lln-word">...</span></span>
        <span class="lln-word">而<span class="translit">ér</span></span>
        <span class="lln-word">...</span>
        <span class="lln-word">二<span class="translit">èr</span></span>
        <span class="lln-word">樓<span class="translit">lóu</span></span>
        <span class="lln-word">...</span>
        <span class="lln-word">則<span class="translit">zé</span></span>
      </div></div>`;
    expect(extractSubtitle(document)).toBe('而二樓則');
  });

  it('does not modify the page while reading Language Reactor', () => {
    document.body.innerHTML = `
      <div id="lln-main-subs"><div class="lln-subs-text">
        <span class="lln-word">好<span class="translit">hǎo</span></span></div></div>`;
    extractSubtitle(document);
    expect(document.querySelectorAll('.translit')).toHaveLength(1);
  });

  it('returns an empty string when there is no subtitle anywhere', () => {
    document.body.innerHTML = '<div class="player-timedtext"></div><div id="lln-main-subs"></div>';
    expect(extractSubtitle(document)).toBe('');
    document.body.innerHTML = '<p>nothing</p>';
    expect(extractSubtitle(document)).toBe('');
  });
});
