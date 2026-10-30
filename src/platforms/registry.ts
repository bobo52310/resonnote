import { formatTime } from '../core/format';
import type { Platform } from '../core/types';
import { parseWatchVideoId as parseDisney, watchUrl as disneyWatchUrl } from './disney/url';
import { parseWatchVideoId as parseNetflix, watchUrl as netflixWatchUrl } from './netflix/url';
import { parseWatchVideoId as parseYouTube, watchUrl as youTubeWatchUrl } from './youtube/url';

/** Pure data and functions only (no browser APIs): the background, the notebook and the exports share it. */
export interface PlatformInfo {
  id: Platform;
  /** 'Netflix' | 'YouTube' | 'Disney+' */
  label: string;
  parseWatchVideoId(url: string | undefined): string | null;
  watchUrl(videoId: string, timeMs: number): string;
  /** True when watchUrl itself starts playback at timeMs (Netflix, YouTube); false for Disney+. */
  linkKeepsTime: boolean;
  /** Match patterns for browser.tabs.query({ url }) that cover every watch page of the platform. */
  tabPatterns: string[];
}

export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  netflix: {
    id: 'netflix',
    label: 'Netflix',
    parseWatchVideoId: parseNetflix,
    watchUrl: netflixWatchUrl,
    linkKeepsTime: true,
    // The second pattern covers locale-prefixed watch pages (/tw/watch/…); callers check the id.
    tabPatterns: ['https://www.netflix.com/watch/*', 'https://www.netflix.com/*/watch/*'],
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube',
    parseWatchVideoId: parseYouTube,
    watchUrl: youTubeWatchUrl,
    linkKeepsTime: true,
    tabPatterns: [
      'https://www.youtube.com/watch*',
      'https://www.youtube.com/shorts/*',
      'https://www.youtube.com/live/*',
    ],
  },
  disney: {
    id: 'disney',
    label: 'Disney+',
    parseWatchVideoId: parseDisney,
    watchUrl: disneyWatchUrl,
    linkKeepsTime: false,
    // Watch pages may carry a locale segment, so match the whole site; callers check the id.
    tabPatterns: ['https://www.disneyplus.com/*'],
  },
};

const PLATFORMS = Object.keys(PLATFORM_INFO);

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && PLATFORMS.includes(value);
}

/** Which platform's watch page `url` is, and the id of what plays there; `null` for any other page. */
export function detectWatchPage(
  url: string | undefined,
): { platform: Platform; videoId: string } | null {
  for (const info of Object.values(PLATFORM_INFO)) {
    const videoId = info.parseWatchVideoId(url);
    if (videoId !== null) return { platform: info.id, videoId };
  }
  return null;
}

/**
 * The text of the link back to a moment. A link that cannot start at that second says where the
 * moment is instead, because whoever follows it (from a shared page, a Markdown file) lands at
 * the start or where they stopped.
 */
export function watchLinkText(platform: Platform, timeMs: number): string {
  const { label, linkKeepsTime } = PLATFORM_INFO[platform];
  const time = formatTime(timeMs);
  return linkKeepsTime ? `在 ${label} 從 ${time} 開始看` : `在 ${label} 打開（這一刻在 ${time}）`;
}
