const WATCH_ORIGIN = 'https://www.disneyplus.com';
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Disney+ puts a locale segment in front of the path: /zh-hant/play/…, /en-gb/play/…. /video/ is the older form.
const WATCH_PATH = new RegExp(`^(?:/[a-z]{2}(?:-[a-z0-9]{2,4})?)?/(?:play|video)/(${UUID})/?$`);

/**
 * Link that opens the title. It cannot carry a time: Disney+ has no such parameter and resumes
 * where the account stopped, so whoever follows the link has to seek by hand.
 */
export function watchUrl(videoId: string): string {
  return `${WATCH_ORIGIN}/play/${encodeURIComponent(videoId)}`;
}

/**
 * The play id (a UUID, lower-cased) of a Disney+ watch page (`/play/<uuid>` or `/video/<uuid>`,
 * with an optional locale segment such as `/zh-hant/`), or `null` for any other URL. Query string
 * and fragment are ignored.
 */
export function parseWatchVideoId(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== WATCH_ORIGIN) return null;
    return WATCH_PATH.exec(parsed.pathname)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
