export type Platform = 'netflix' | 'youtube' | 'disney';
/** `frame` is the raw picture taken from the <video> itself: full quality, but without subtitles. */
export type ImageSource = 'tab' | 'frame' | 'trickplay' | 'none';
export type Missing = 'fullFrame' | 'image' | 'subtitle' | 'title' | 'playerApi' | 'useShortcutOnce';
export interface Rect { x: number; y: number; width: number; height: number }
export interface Playback {
  videoId: string; title: string; timeMs: number;
  season?: number; episode?: number; episodeTitle?: string;
}
export interface Note extends Playback {
  id: string; platform: Platform; subtitle: string; body: string;
  image: { source: ImageSource; width: number; height: number };
  createdAt: string; updatedAt: string;
}
