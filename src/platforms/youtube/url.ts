// Only the main site: m.youtube.com, music.youtube.com, youtu.be and /embed/ pages are not supported.
const WATCH_ORIGINS: ReadonlySet<string> = new Set([
  'https://www.youtube.com',
  'https://youtube.com',
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SHORTS_OR_LIVE_PATH = /^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})\/?$/;

/** Link that opens the video at the given moment (whole seconds, floored). */
export function watchUrl(videoId: string, timeMs: number): string {
  const seconds = Number.isFinite(timeMs) ? Math.max(0, Math.floor(timeMs / 1000)) : 0;
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${seconds}s`;
}

/**
 * The video id of a YouTube watch page (`/watch?v=<id>`, `/shorts/<id>` or `/live/<id>` on
 * `www.youtube.com` or `youtube.com`), or `null` for any other URL. Other query parameters and
 * the fragment are ignored.
 */
export function parseWatchVideoId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!WATCH_ORIGINS.has(parsed.origin)) return null;
    if (parsed.pathname === '/watch') {
      const id = parsed.searchParams.get('v');
      return id !== null && VIDEO_ID.test(id) ? id : null;
    }
    return SHORTS_OR_LIVE_PATH.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
