import type { Note } from './types';

const MAX_FILE_NAME_LENGTH = 80;

/** Formats milliseconds as `m:ss` or `h:mm:ss`, flooring to whole seconds. */
export function formatTime(ms: number): string {
  const totalSeconds = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/** Human-readable heading: title, then season/episode, then episode title (each when present). */
export function noteHeading(
  n: Pick<Note, 'title' | 'season' | 'episode' | 'episodeTitle'>,
): string {
  const parts = [n.title];
  // Season and episode read as one token: 第1季第2集
  const position =
    (n.season !== undefined ? `第${n.season}季` : '') +
    (n.episode !== undefined ? `第${n.episode}集` : '');
  if (position) parts.push(position);
  if (n.episodeTitle) parts.push(n.episodeTitle);
  return parts.join(' ');
}

/** Replaces characters illegal in file names with `_`, trims, caps at 80 chars; empty -> `untitled`. */
export function safeFileName(s: string): string {
  const cleaned = s.replace(/[/\\:*?"<>|]/g, '_').trim();
  const truncated = Array.from(cleaned).slice(0, MAX_FILE_NAME_LENGTH).join('').trim();
  return truncated === '' ? 'untitled' : truncated;
}
