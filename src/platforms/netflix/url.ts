const WATCH_ORIGIN = 'https://www.netflix.com';
// Netflix puts a locale segment in front of the path for some accounts: /tw/watch/…, /br-en/watch/….
const WATCH_PATH = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/watch\/(\d+)\/?$/;

/** Deep link that opens the title at the given moment (whole seconds, floored). */
export function watchUrl(videoId: string, timeMs: number): string {
  const seconds = Number.isFinite(timeMs) ? Math.max(0, Math.floor(timeMs / 1000)) : 0;
  return `${WATCH_ORIGIN}/watch/${videoId}?t=${seconds}`;
}

/**
 * The video id of a Netflix watch page (`https://www.netflix.com/watch/<digits>`, with an optional
 * locale segment such as `/tw/` or `/br-en/` before `watch`), or `null` for any other URL. Query
 * string and fragment are ignored.
 */
export function parseWatchVideoId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== WATCH_ORIGIN) return null;
    return WATCH_PATH.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
