/** Matches in `root` and in every open shadow root below it (Disney+ builds its player UI from web components). */
export function deepQueryAll(root: ParentNode, selector: string): Element[] {
  const found = Array.from(root.querySelectorAll(selector));
  for (const host of Array.from(root.querySelectorAll('*'))) {
    if (host.shadowRoot !== null) found.push(...deepQueryAll(host.shadowRoot, selector));
  }
  return found;
}

/** The text of each line element, whitespace collapsed, empty ones dropped, joined by single spaces. */
function joinLines(lines: Element[]): string {
  return lines
    .map((line) => (line.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter((text) => text !== '')
    .join(' ');
}

/**
 * The subtitle currently on screen. Measured 2026-10-29: the lines sit in the open shadow root of
 * `timed-text-override-region` as `.hive-subtitle-renderer-line`. Failing that, the same class
 * (an older layout kept it in the light DOM) or the previous renderer's `.dss-subtitle-renderer-line`
 * anywhere in the document. '' when there is none. Never throws.
 */
export function extractSubtitle(doc: Document): string {
  try {
    const region = doc.querySelector('timed-text-override-region');
    if (region?.shadowRoot) {
      const text = joinLines(Array.from(region.shadowRoot.querySelectorAll('.hive-subtitle-renderer-line')));
      if (text !== '') return text;
    }
    return joinLines(deepQueryAll(doc, '.hive-subtitle-renderer-line, .dss-subtitle-renderer-line'));
  } catch {
    return '';
  }
}
