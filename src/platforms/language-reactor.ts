/** Chinese/Japanese/Korean characters and punctuation (CJK symbols, kana, ideographs, compatibility, full-width forms). */
const CJK = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/;
/** A run of `...` or `…` markers at the start or end of a token. */
const EDGE_ELLIPSIS = /^(?:\.{3,}|…)+|(?:\.{3,}|…)+$/g;

/**
 * Cleans the text Language Reactor renders word by word (`... 而 ... 二 樓 ...`):
 * drops the `...` / `…` markers, then joins neighbouring CJK characters directly and any
 * other neighbours with one space.
 */
export function cleanLanguageReactorText(raw: string): string {
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(EDGE_ELLIPSIS, ''))
    .filter((token) => token !== '');

  let out = '';
  let previous = '';
  for (const token of tokens) {
    if (previous !== '') {
      const joinsDirectly = CJK.test(previous.slice(-1)) && CJK.test(token.charAt(0));
      if (!joinsDirectly) out += ' ';
    }
    out += token;
    previous = token;
  }
  return out;
}

/** Language Reactor line with its pinyin/transliteration removed, then cleaned. The page is left untouched. */
function languageReactorLine(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const translit of Array.from(copy.querySelectorAll('.translit'))) translit.remove();
  return cleanLanguageReactorText(copy.textContent ?? '');
}

/**
 * Language Reactor's subtitle line (`#lln-main-subs .lln-subs-text`), or ''. Streaming sites'
 * own subtitle layer is empty while the extension is on, so every platform falls back to this.
 * Never throws.
 */
export function extractLanguageReactorSubtitle(doc: Document): string {
  try {
    return Array.from(doc.querySelectorAll('#lln-main-subs .lln-subs-text'))
      .map(languageReactorLine)
      .filter((line) => line !== '')
      .join(' ');
  } catch {
    return '';
  }
}
