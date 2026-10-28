import type { Missing, Playback, Rect } from '../core/types';

/**
 * What the capture controller needs from a streaming site. Every method fails soft:
 * it resolves to `null` / `false` / `''` instead of throwing.
 */
export interface PlatformAdapter {
  /**
   * Current playback state. `missing` lists what had to be guessed:
   * `'playerApi'` when the in-page player API was unavailable (fell back to the URL and
   * `<video>`), `'title'` when the title is the tab title or the video id.
   */
  getPlayback(): Promise<{ playback: Playback; missing: Missing[] } | null>;
  /** The subtitle line on screen right now, or '' when there is none. */
  getSubtitleText(): string;
  pause(): Promise<boolean>;
  play(): Promise<boolean>;
  seek(timeMs: number): Promise<boolean>;
  /** The area of the viewport (CSS px) covered by the video picture, letterbox bars excluded. */
  getVideoRect(): Rect | null;
  /** JPEG bytes of the scrubber preview image at `timeMs`. */
  getTrickplayFrame(timeMs: number): Promise<Uint8Array | null>;
  watchUrl(videoId: string, timeMs: number): string;
}
