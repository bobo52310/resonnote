import type { Note, Platform } from './types';

/** Answer to `resonnote/begin`: whether a capture may go ahead. */
export type BeginResult = { status: 'ok' } | { status: 'busy' } | { status: 'no-video' };

/** Background -> content script. */
export type ToContent =
  | { type: 'resonnote/begin' }
  | {
      type: 'resonnote/show';
      dataUrl: string | null;
      /** Set when the on-page button could not take a screenshot (no shortcut used in this tab yet). */
      hint?: 'use-shortcut-once';
    }
  | {
      type: 'resonnote/seek';
      timeMs: number;
      /**
       * The title the seek is meant for. A page that plays something else (the tab moved on while
       * a retry was pending) declines, so the wrong video is never moved or paused.
       */
      videoId?: string;
    };

/** Content script (or extension page) -> background. Images travel as data URLs: messages are JSON. */
export type ToBackground =
  | { type: 'resonnote/save'; note: Note; imageDataUrl: string | null }
  | { type: 'resonnote/open-notebook' }
  | { type: 'resonnote/jump'; platform: Platform; videoId: string; timeMs: number }
  | { type: 'resonnote/recent'; platform: Platform; videoId: string; limit: number }
  /** Edits made to an earlier note from the overlay's film strip. */
  | { type: 'resonnote/update'; id: string; subtitle: string; body: string }
  /** An earlier note deleted from the overlay's film strip. */
  | { type: 'resonnote/delete'; id: string }
  /** The on-page 「記下這一刻」 button: same as the shortcut, for the tab that sent it. */
  | { type: 'resonnote/trigger' }
  /** The shortcut as the user has set it (for example 「⌥⇧N」), or '' when none is set. */
  | { type: 'resonnote/shortcut' };

/**
 * One earlier note of the same video (same platform and videoId), as the note overlay shows it
 * behind the new picture.
 */
export interface RecentNote {
  id: string;
  timeMs: number;
  subtitle: string;
  body: string;
  /** A small JPEG `data:` URL, or null when the note has no picture. */
  thumb: string | null;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

/** Answer to `resonnote/jump`: which way the user was taken back to the moment. */
export type JumpResult = { ok: true; result: 'existing' | 'new' } | { ok: false; error: string };

const DATA_URL_BASE64 = /^data:[^,;]*(?:;[^,;]*)*;base64,/i;
const ENCODE_CHUNK = 0x8000;

/** Decodes a `data:<type>;base64,<payload>` URL. Throws when the string is not one. */
export function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const header = DATA_URL_BASE64.exec(dataUrl)?.[0];
  if (header === undefined) throw new Error('not a base64 data URL');
  const binary = atob(dataUrl.slice(header.length));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encodes bytes as a `data:<mime>;base64,…` URL (the form images take inside messages). */
export function bytesToDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + ENCODE_CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
