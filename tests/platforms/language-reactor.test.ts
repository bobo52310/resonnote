import { beforeEach, describe, expect, it } from 'vitest';
import {
  cleanLanguageReactorText,
  extractLanguageReactorSubtitle,
} from '../../src/platforms/language-reactor';

describe('cleanLanguageReactorText', () => {
  it('drops ellipsis markers and joins CJK characters directly', () => {
    expect(
      cleanLanguageReactorText(
        '... 而 ... 二 樓 ... 則 ... 是 ... 蔣 經 國 ... 先 生 ... 和 ... 政 府 ... 高 層',
      ),
    ).toBe('而二樓則是蔣經國先生和政府高層');
  });

  it('keeps one space between non-CJK words', () => {
    expect(cleanLanguageReactorText("I ... don't ... know ...")).toBe("I don't know");
  });

  it('keeps a space between CJK and Latin text', () => {
    expect(cleanLanguageReactorText('我 用 iPhone 拍')).toBe('我用 iPhone 拍');
  });

  it('strips the ellipsis glued to a word, including the single-character form', () => {
    expect(cleanLanguageReactorText('...wait… what....')).toBe('wait what');
  });

  it('returns an empty string for blank or marker-only input', () => {
    expect(cleanLanguageReactorText('')).toBe('');
    expect(cleanLanguageReactorText('  ...  …  ')).toBe('');
  });
});

describe('extractLanguageReactorSubtitle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes the pinyin and cleans the words', () => {
    document.body.innerHTML = `
      <div id="lln-main-subs"><div class="lln-subs-text">
        <span class="lln-word">...</span>
        <span class="lln-word">而<span class="translit">ér</span></span>
        <span class="lln-word">二<span class="translit">èr</span></span>
        <span class="lln-word">樓<span class="translit">lóu</span></span>
      </div></div>`;
    expect(extractLanguageReactorSubtitle(document)).toBe('而二樓');
  });

  it('joins several lines with a space and skips empty ones', () => {
    document.body.innerHTML = `
      <div id="lln-main-subs">
        <div class="lln-subs-text">first line</div>
        <div class="lln-subs-text">  ...  </div>
        <div class="lln-subs-text">second line</div>
      </div>`;
    expect(extractLanguageReactorSubtitle(document)).toBe('first line second line');
  });

  it('is empty when Language Reactor is not on the page', () => {
    document.body.innerHTML = '<div class="lln-subs-text">outside the container</div>';
    expect(extractLanguageReactorSubtitle(document)).toBe('');
  });

  it('leaves the page untouched', () => {
    document.body.innerHTML = `
      <div id="lln-main-subs"><div class="lln-subs-text"><span>而<span class="translit">ér</span></span></div></div>`;
    extractLanguageReactorSubtitle(document);
    expect(document.querySelector('.translit')).not.toBeNull();
  });
});
