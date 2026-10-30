/**
 * Makes `window.postMessage` report its sender the way Chrome does.
 *
 * The page bridges (and `callBridge`) only act on messages whose `event.source` is their own
 * window. Chrome sets `source` to the window that called `postMessage`, so a window posting to
 * itself, as the content script and the page bridge do, sees `event.source === window` in the
 * receiving world too (checked in Chrome 156 with a loaded extension: isolated world to MAIN
 * world and back). happy-dom puts its internal Window object there instead, and under Vitest that
 * is not `window` (`window` is the global object). Rather than weaken the check, rewrite the
 * source of the messages happy-dom itself delivers. Events a test builds with
 * `new MessageEvent(...)` (a frame of another origin, `source: null`) are left as they are.
 */
const happyDomWindow = await new Promise<unknown>((resolve) => {
  window.addEventListener('message', (event) => resolve(event.source), { once: true });
  window.postMessage('source-probe', '*');
});

window.addEventListener('message', (event) => {
  if (event.source === happyDomWindow) (event as { source: unknown }).source = window;
});
