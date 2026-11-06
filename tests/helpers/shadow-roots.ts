import { afterEach, beforeEach } from 'vitest';

/**
 * The note overlay and the on-page button keep their UI in closed shadow roots, so
 * `host.shadowRoot` is null for them, as it is for the page's own scripts. Tests reach inside
 * through the root `attachShadow` handed out, recorded here.
 *
 * Call it at the top level of a test file, before the file's own `beforeEach` hooks, so the
 * recording is in place by the time those mount anything. Returns the lookup: the shadow root
 * attached to `host`, or null when there is no host (or it never got one).
 */
export function recordShadowRoots(): (host: Element | null | undefined) => ShadowRoot | null {
  const roots = new WeakMap<Element, ShadowRoot>();
  let original: Element['attachShadow'] | undefined;

  beforeEach(() => {
    const attach = Element.prototype.attachShadow;
    original = attach;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit): ShadowRoot {
      const root = attach.call(this, init);
      roots.set(this, root);
      return root;
    };
  });

  afterEach(() => {
    if (original) Element.prototype.attachShadow = original;
    original = undefined;
  });

  return (host) => (host ? (roots.get(host) ?? null) : null);
}
