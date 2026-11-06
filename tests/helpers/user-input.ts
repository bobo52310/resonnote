import { afterEach, beforeEach } from 'vitest';

/**
 * happy-dom has no `Event.isTrusted`. The note overlay and the on-page button act only on trusted
 * events: in Chrome those come from real input, while an event a page script makes with
 * `dispatchEvent()` or `click()` has `isTrusted === false`. The tests stand for the user, so while
 * this is installed every event counts as trusted, except one passed through `forged()`.
 *
 * Call it at the top level of a test file.
 */
export function treatEventsAsUserInput(): void {
  let previous: PropertyDescriptor | undefined;

  beforeEach(() => {
    previous = Object.getOwnPropertyDescriptor(Event.prototype, 'isTrusted');
    Object.defineProperty(Event.prototype, 'isTrusted', {
      configurable: true,
      get(this: Event) {
        return !forgedEvents.has(this);
      },
    });
  });

  afterEach(() => {
    if (previous) Object.defineProperty(Event.prototype, 'isTrusted', previous);
    else Reflect.deleteProperty(Event.prototype, 'isTrusted');
    previous = undefined;
  });
}

const forgedEvents = new WeakSet<Event>();

/** Marks `event` as made by a page script (`isTrusted === false`), and returns it. */
export function forged<T extends Event>(event: T): T {
  forgedEvents.add(event);
  return event;
}
