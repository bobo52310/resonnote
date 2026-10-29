import { formatTime } from '../core/format';
import type { Note } from '../core/types';
import { PLATFORM_INFO, watchLinkText } from '../platforms/registry';
import { groupByHeading } from './group';

const IMAGE_DATA_URL_PREFIX = 'data:image/';

const STYLE = `
:root { color-scheme: light dark; --bg: #f6f5f3; --card: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e2e0dc; --accent: #c4161c; }
@media (prefers-color-scheme: dark) { :root { --bg: #141414; --card: #1f1f1f; --text: #f2f2f2; --muted: #a0a0a6; --line: #333333; --accent: #ff6b6f; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; }
main { max-width: 720px; margin: 0 auto; }
h1 { font-size: 1.5rem; line-height: 1.3; margin: 8px 0 20px; }
h2 { font-size: 1.15rem; line-height: 1.4; margin: 28px 0 12px; color: var(--muted); }
article { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px; margin: 0 0 16px; }
article img { display: block; width: 100%; height: auto; border-radius: 8px; margin: 0 0 12px; }
.time { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--accent); margin: 0 0 6px; }
blockquote { margin: 0 0 12px; padding: 2px 0 2px 12px; border-left: 3px solid var(--line); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.body { margin: 0 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.watch { display: inline-block; font-size: 0.9rem; color: var(--accent); }
`;

/** Escapes text for use in HTML element content and double- or single-quoted attributes. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function articleHtml(note: Note, imageDataUrl: string | undefined): string {
  const time = formatTime(note.timeMs);
  const parts: string[] = [];
  if (imageDataUrl !== undefined && imageDataUrl.startsWith(IMAGE_DATA_URL_PREFIX)) {
    parts.push(`<img src="${esc(imageDataUrl)}" alt="${esc(time)}">`);
  }
  parts.push(`<p class="time">${esc(time)}</p>`);
  if (note.subtitle !== '') parts.push(`<blockquote>${esc(note.subtitle)}</blockquote>`);
  if (note.body !== '') parts.push(`<p class="body">${esc(note.body)}</p>`);
  const link = PLATFORM_INFO[note.platform].watchUrl(note.videoId, note.timeMs);
  parts.push(`<a class="watch" href="${esc(link)}">${esc(watchLinkText(note.platform, note.timeMs))}</a>`);
  return `<article>\n${parts.join('\n')}\n</article>`;
}

/**
 * A single self-contained page (CSS inline, images embedded as data URLs) meant to be
 * opened on a phone. Every piece of user text is HTML-escaped. `imageDataUrls` is keyed by
 * note id; notes without an entry (or with a non-image value) are rendered without a picture.
 */
export function buildHtml(
  title: string,
  notes: Note[],
  imageDataUrls: Map<string, string>,
): string {
  const groups = groupByHeading(notes);
  const sections = groups.map((group) => {
    // A lone group whose heading is already the page title would just repeat it.
    const showHeading = groups.length > 1 || group.heading !== title;
    const heading = showHeading ? `<h2>${esc(group.heading)}</h2>\n` : '';
    const articles = group.notes.map((note) => articleHtml(note, imageDataUrls.get(note.id)));
    return `${heading}${articles.join('\n')}`;
  });
  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${sections.join('\n')}
</main>
</body>
</html>
`;
}
