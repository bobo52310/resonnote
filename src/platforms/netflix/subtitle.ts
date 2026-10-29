import { extractLanguageReactorSubtitle } from '../language-reactor';

/** Text of `el` with line breaks read as spaces and runs of whitespace collapsed. */
function plainText(el: Element, doc: Document): string {
  const copy = el.cloneNode(true) as Element;
  for (const br of Array.from(copy.querySelectorAll('br'))) {
    br.replaceWith(doc.createTextNode(' '));
  }
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The subtitle currently on screen: Netflix's own `.player-timedtext` first, then Language
 * Reactor's line (Netflix hides its own line while the extension is on), else ''. Never throws.
 */
export function extractSubtitle(doc: Document): string {
  try {
    const native = doc.querySelector('.player-timedtext');
    if (native) {
      const text = plainText(native, doc);
      if (text !== '') return text;
    }
    return extractLanguageReactorSubtitle(doc);
  } catch {
    return '';
  }
}
