import { describe, expect, it } from 'vitest';
import { contentRect, isBlockedFrame, toDevicePx } from '../../src/core/capture-math';

type Img = { data: Uint8ClampedArray; width: number; height: number };

/** Opaque grayscale image where every pixel has the same value. */
function solid(width: number, height: number, value: number): Img {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** Black image whose rows from `fromY * height` downwards are gray (128). */
function blackWithGrayBottom(width: number, height: number, fromY: number): Img {
  const img = solid(width, height, 0);
  const startRow = Math.floor(height * fromY);
  for (let y = startRow; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      img.data[i] = 128;
      img.data[i + 1] = 128;
      img.data[i + 2] = 128;
    }
  }
  return img;
}

describe('contentRect', () => {
  it('letterboxes left and right when the box is wider than the video', () => {
    const r = contentRect({ x: 0, y: 0, width: 1440, height: 748 }, 1920, 1080);
    expect(r.height).toBeCloseTo(748);
    expect(r.width).toBeCloseTo(1329.78, 1);
    expect(r.x).toBeCloseTo(55.11, 1);
    expect(r.y).toBe(0);
  });

  it('letterboxes top and bottom when the box is taller than the video', () => {
    const t = contentRect({ x: 0, y: 0, width: 1000, height: 1000 }, 1920, 1080);
    expect(t.width).toBe(1000);
    expect(t.y).toBeCloseTo(218.75);
  });

  it('keeps the box offset in the result', () => {
    const r = contentRect({ x: 10, y: 20, width: 1000, height: 1000 }, 1920, 1080);
    expect(r.x).toBe(10);
    expect(r.y).toBeCloseTo(238.75);
  });

  it('returns the box unchanged when the video size is not known yet', () => {
    const box = { x: 1, y: 2, width: 300, height: 200 };
    expect(contentRect(box, 0, 0)).toEqual(box);
  });
});

describe('toDevicePx', () => {
  it('multiplies by dpr and rounds to whole pixels', () => {
    expect(
      toDevicePx({ x: 55.11, y: 0, width: 1329.78, height: 748 }, 2, 2880, 1496),
    ).toEqual({ x: 110, y: 0, width: 2660, height: 1496 });
  });

  it('clamps the rect to the image bounds', () => {
    expect(toDevicePx({ x: -5, y: -5, width: 2000, height: 2000 }, 1, 100, 50)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it('returns an empty rect when the crop lies fully outside the image', () => {
    const r = toDevicePx({ x: 500, y: 500, width: 10, height: 10 }, 1, 100, 50);
    expect(r.width).toBe(0);
    expect(r.height).toBe(0);
  });
});

describe('isBlockedFrame', () => {
  it('treats an all-black frame as blocked', () => {
    expect(isBlockedFrame(solid(100, 100, 0))).toBe(true);
  });

  it('treats a mid-gray frame as not blocked', () => {
    expect(isBlockedFrame(solid(100, 100, 128))).toBe(false);
  });

  it('ignores bright pixels outside the inspected region (subtitle area)', () => {
    expect(isBlockedFrame(blackWithGrayBottom(100, 100, 0.7))).toBe(true);
  });

  it('detects content inside the inspected region', () => {
    expect(isBlockedFrame(blackWithGrayBottom(100, 100, 0.3))).toBe(false);
  });

  it('uses luminance 16 as the dark threshold', () => {
    expect(isBlockedFrame(solid(100, 100, 15))).toBe(true);
    expect(isBlockedFrame(solid(100, 100, 16))).toBe(false);
  });

  it('weights channels by luminance (pure green is bright, pure blue is dark)', () => {
    const green = solid(100, 100, 0);
    const blue = solid(100, 100, 0);
    for (let i = 0; i < 100 * 100; i++) {
      green.data[i * 4 + 1] = 30; // 0.7152 * 30 = 21.5 >= 16
      blue.data[i * 4 + 2] = 30; // 0.0722 * 30 = 2.2 < 16
    }
    expect(isBlockedFrame(green)).toBe(false);
    expect(isBlockedFrame(blue)).toBe(true);
  });

  it('requires more than 95% dark pixels in the region', () => {
    // Region of a 100x100 image: x 20..80, y 15..60 = 60 x 45 = 2700 pixels.
    // 135 bright pixels = exactly 5% -> dark ratio is 0.95, not > 0.95.
    const exactly = solid(100, 100, 0);
    const slightly = solid(100, 100, 0);
    const paint = (img: Img, count: number) => {
      let n = 0;
      for (let y = 15; y < 60 && n < count; y++) {
        for (let x = 20; x < 80 && n < count; x++, n++) {
          const i = (y * 100 + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        }
      }
    };
    paint(exactly, 135);
    paint(slightly, 134);
    expect(isBlockedFrame(exactly)).toBe(false);
    expect(isBlockedFrame(slightly)).toBe(true);
  });

  it('does not report an empty image as blocked', () => {
    expect(isBlockedFrame({ data: new Uint8ClampedArray(0), width: 0, height: 0 })).toBe(false);
  });
});
