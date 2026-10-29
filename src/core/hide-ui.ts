/** Inline styles that make an element invisible at once, without moving anything. */
const HIDDEN: ReadonlyArray<[string, string]> = [
  ['opacity', '0'],
  // Players fade their controls; without this the fade-out could still be in the screenshot.
  ['transition', 'none'],
];

interface Saved {
  el: HTMLElement;
  hadStyle: boolean;
  values: Array<[property: string, value: string, priority: string]>;
}

/**
 * Makes everything under `root` invisible except the elements matching `keep` (the video and
 * the subtitle layers, as a selector list), so a screenshot shows only the scene: no scrubber,
 * buttons or title bar. Works without knowing the site's class names: any child that neither
 * matches nor holds a kept element is hidden, and children that hold one are walked into.
 * `opacity` keeps the layout, so the video does not move.
 *
 * Returns a function that puts every touched style back; calling it more than once is harmless.
 */
export function hidePlayerUi(root: Element, keep: string): () => void {
  const saved: Saved[] = [];

  const hide = (el: HTMLElement) => {
    const values = HIDDEN.map(([property]): [string, string, string] => [
      property,
      el.style.getPropertyValue(property),
      el.style.getPropertyPriority(property),
    ]);
    saved.push({ el, hadStyle: el.hasAttribute('style'), values });
    for (const [property, value] of HIDDEN) el.style.setProperty(property, value, 'important');
  };

  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (child.matches(keep)) continue;
      if (child.querySelector(keep) !== null) walk(child);
      else if (child instanceof HTMLElement) hide(child);
    }
  };

  walk(root);

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const { el, hadStyle, values } of saved) {
      for (const [property, value, priority] of values) {
        if (value === '') el.style.removeProperty(property);
        else el.style.setProperty(property, value, priority);
      }
      // Leave no empty style="" behind on elements that had none.
      if (!hadStyle && el.style.length === 0) el.removeAttribute('style');
    }
  };
}
