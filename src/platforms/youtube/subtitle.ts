import { extractLanguageReactorSubtitle } from '../language-reactor';

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * One caption window: its lines (`.caption-visual-line`, each made of `.ytp-caption-segment`
 * pieces that already carry their own spaces) joined by single spaces.
 */
function windowText(captionWindow: Element): string {
  return Array.from(captionWindow.querySelectorAll('.caption-visual-line'))
    .map((line) =>
      squash(
        Array.from(line.querySelectorAll('.ytp-caption-segment'))
          .map((segment) => segment.textContent ?? '')
          .join(''),
      ),
    )
    .filter((line) => line !== '')
    .join(' ');
}

/**
 * The subtitle currently on screen: YouTube's own caption windows first, then Language
 * Reactor's line (it hides the native captions while on), else ''. `scope` narrows the search
 * to the player element, so the idle player of a Shorts page is not read. Never throws.
 *
 * Switching captions on or changing their language adds a window with the language name and a
 * settings icon for a few seconds; it is no dialogue, so any window holding an `<svg>` is skipped.
 */
export function extractSubtitle(doc: Document, scope: ParentNode = doc): string {
  try {
    const native = Array.from(scope.querySelectorAll('.caption-window'))
      .filter((captionWindow) => captionWindow.querySelector('svg') === null)
      .map(windowText)
      .filter((text) => text !== '')
      .join(' ');
    return native !== '' ? native : extractLanguageReactorSubtitle(doc);
  } catch {
    return '';
  }
}
