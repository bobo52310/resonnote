/**
 * Parser for Netflix BIF (trickplay) files: one file per title, holding a low-res
 * JPEG preview for every `intervalMs` of playback.
 *
 * Layout (all integers little-endian uint32):
 *   0..7    magic 89 42 49 46 0d 0a 1a 0a
 *   12      frame count
 *   16      interval in ms (0 means 1000)
 *   64..    index table of count + 1 entries, each (frameNo, byteOffset); the last
 *           entry is a terminator (frameNo 0xffffffff) whose offset marks the end of
 *           the final image, so image i is bytes [offsets[i], offsets[i + 1]).
 */

export interface BifIndex {
  count: number;
  intervalMs: number;
  /** Byte offsets of each image start; `count + 1` entries (the last is the end of the final image). */
  offsets: number[];
}

const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const COUNT_OFFSET = 12;
const INTERVAL_OFFSET = 16;
const INDEX_OFFSET = 64;
const ENTRY_SIZE = 8;
const DEFAULT_INTERVAL_MS = 1000;

/** Returns `null` for anything that is not a well-formed BIF; never throws. */
export function parseBif(buf: ArrayBuffer): BifIndex | null {
  if (buf.byteLength < INDEX_OFFSET) return null;

  const bytes = new Uint8Array(buf);
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return null;
  }

  const view = new DataView(buf);
  const count = view.getUint32(COUNT_OFFSET, true);
  const intervalMs = view.getUint32(INTERVAL_OFFSET, true) || DEFAULT_INTERVAL_MS;
  if (count === 0) return null;

  // Check the table fits before allocating anything sized by the untrusted count.
  if (INDEX_OFFSET + (count + 1) * ENTRY_SIZE > buf.byteLength) return null;

  const offsets: number[] = [];
  let previous = 0;
  for (let i = 0; i <= count; i++) {
    const offset = view.getUint32(INDEX_OFFSET + i * ENTRY_SIZE + 4, true);
    if (offset > buf.byteLength || offset < previous) return null;
    offsets.push(offset);
    previous = offset;
  }

  return { count, intervalMs, offsets };
}

/**
 * Returns a copy of the JPEG bytes for the frame covering `timeMs`.
 * The index is clamped, so times before 0 give the first frame and times past the end
 * give the last one. It is a copy (not a view) so that posting it across contexts does
 * not drag the whole multi-megabyte BIF buffer along.
 */
export function bifFrame(buf: ArrayBuffer, index: BifIndex, timeMs: number): Uint8Array {
  const raw = Number.isFinite(timeMs) ? Math.floor(timeMs / index.intervalMs) : 0;
  const i = Math.min(Math.max(raw, 0), index.count - 1);
  return new Uint8Array(buf).slice(index.offsets[i], index.offsets[i + 1]);
}
