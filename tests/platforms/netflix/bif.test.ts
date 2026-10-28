import { describe, expect, it } from 'vitest';
import { bifFrame, parseBif } from '../../../src/platforms/netflix/bif';

const u8 = (...bytes: number[]) => new Uint8Array(bytes);

const MAGIC = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_SIZE = 64;

/** Builds a small BIF: 64-byte header, (count + 1) index entries, then the frame bytes. */
function makeBif(frames: Uint8Array[], intervalMs: number): ArrayBuffer {
  const count = frames.length;
  const dataStart = HEADER_SIZE + (count + 1) * 8;
  const total = dataStart + frames.reduce((n, f) => n + f.length, 0);
  const buf = new ArrayBuffer(total);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  bytes.set(MAGIC, 0);
  view.setUint32(8, 0, true); // version
  view.setUint32(12, count, true);
  view.setUint32(16, intervalMs, true);

  let offset = dataStart;
  frames.forEach((frame, i) => {
    view.setUint32(HEADER_SIZE + i * 8, i, true);
    view.setUint32(HEADER_SIZE + i * 8 + 4, offset, true);
    bytes.set(frame, offset);
    offset += frame.length;
  });
  // Terminator entry: frameNo 0xffffffff, offset = end of the last frame.
  view.setUint32(HEADER_SIZE + count * 8, 0xffffffff, true);
  view.setUint32(HEADER_SIZE + count * 8 + 4, offset, true);
  return buf;
}

describe('parseBif', () => {
  it('reads count, interval and count + 1 offsets', () => {
    const buf = makeBif([u8(1, 1), u8(2, 2, 2), u8(3)], 10000);
    const idx = parseBif(buf)!;
    expect(idx.count).toBe(3);
    expect(idx.intervalMs).toBe(10000);
    expect(idx.offsets).toHaveLength(4);
    expect(idx.offsets[3]).toBe(buf.byteLength);
  });

  it('treats an interval of 0 as 1000 ms', () => {
    const idx = parseBif(makeBif([u8(1), u8(2)], 0))!;
    expect(idx.intervalMs).toBe(1000);
  });

  it('returns null when the header magic does not match', () => {
    expect(parseBif(new ArrayBuffer(80))).toBeNull();
  });

  it('returns null for a buffer too short to hold a header', () => {
    expect(parseBif(new ArrayBuffer(10))).toBeNull();
    expect(parseBif(new ArrayBuffer(0))).toBeNull();
  });

  it('returns null when the index table is truncated', () => {
    const buf = makeBif([u8(1), u8(2), u8(3)], 1000);
    expect(parseBif(buf.slice(0, HEADER_SIZE + 2 * 8))).toBeNull();
  });

  it('returns null when the frame count is zero', () => {
    expect(parseBif(makeBif([], 1000))).toBeNull();
  });

  it('returns null when an offset points outside the buffer', () => {
    const buf = makeBif([u8(1), u8(2)], 1000);
    new DataView(buf).setUint32(HEADER_SIZE + 2 * 8 + 4, buf.byteLength + 100, true);
    expect(parseBif(buf)).toBeNull();
  });

  it('returns null when offsets go backwards', () => {
    const buf = makeBif([u8(1, 1), u8(2, 2, 2), u8(3)], 1000);
    new DataView(buf).setUint32(HEADER_SIZE + 1 * 8 + 4, HEADER_SIZE, true);
    expect(parseBif(buf)).toBeNull();
  });
});

describe('bifFrame', () => {
  const buf = makeBif([u8(1, 1), u8(2, 2, 2), u8(3)], 10000);
  const idx = parseBif(buf)!;

  it('returns the frame covering the given time', () => {
    expect([...bifFrame(buf, idx, 0)]).toEqual([1, 1]);
    expect([...bifFrame(buf, idx, 9999)]).toEqual([1, 1]);
    expect([...bifFrame(buf, idx, 10000)]).toEqual([2, 2, 2]);
    expect([...bifFrame(buf, idx, 25000)]).toEqual([3]);
  });

  it('clamps past-the-end times to the last frame', () => {
    expect([...bifFrame(buf, idx, 999999)]).toEqual([3]);
  });

  it('clamps negative times to the first frame', () => {
    expect([...bifFrame(buf, idx, -5)]).toEqual([1, 1]);
  });
});

describe('real-world shape', () => {
  it('handles 638 frames at a 10 s interval (106-minute title)', () => {
    const frames = Array.from({ length: 638 }, (_, i) => u8(0xff, 0xd8, i & 0xff, (i >> 8) & 0xff));
    const buf = makeBif(frames, 10000);
    const idx = parseBif(buf)!;
    expect(idx.count).toBe(638);
    expect(idx.offsets).toHaveLength(639);
    expect([...bifFrame(buf, idx, 1003469)]).toEqual([0xff, 0xd8, 100, 0]); // 16:43 -> frame 100
    expect([...bifFrame(buf, idx, 106 * 60 * 1000)]).toEqual([0xff, 0xd8, 636 & 0xff, 636 >> 8]);
    expect([...bifFrame(buf, idx, 107 * 60 * 1000)]).toEqual([0xff, 0xd8, 637 & 0xff, 637 >> 8]); // past the end -> last
  });

  it('returns a compact copy, not a view over the whole file', () => {
    const buf = makeBif([u8(1, 1), u8(2, 2, 2)], 1000);
    const idx = parseBif(buf)!;
    const frame = bifFrame(buf, idx, 1000);
    expect(frame.buffer.byteLength).toBe(frame.byteLength);
  });

  it('treats a non-finite time as the first frame', () => {
    const buf = makeBif([u8(1, 1), u8(2, 2, 2)], 1000);
    expect([...bifFrame(buf, parseBif(buf)!, Number.NaN)]).toEqual([1, 1]);
  });
});
