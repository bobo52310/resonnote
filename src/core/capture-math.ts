import type { Rect } from './types';

/** Region of the frame that is inspected for blockage (fractions of width/height). */
const REGION = { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.6 } as const;
/** A pixel counts as dark when its luminance is below this value (0-255 scale). */
const DARK_LUMINANCE = 16;
/** The frame is blocked when MORE than this share of inspected pixels is dark. */
const BLOCKED_RATIO = 0.95;

/**
 * The area actually covered by the video picture inside `box` under
 * `object-fit: contain` (CSS px). The remainder of the box is letterbox bars.
 * Returns `box` unchanged while the video size is unknown (0 or non-finite).
 */
export function contentRect(box: Rect, videoWidth: number, videoHeight: number): Rect {
  if (
    !(videoWidth > 0) || !(videoHeight > 0) ||
    !Number.isFinite(videoWidth) || !Number.isFinite(videoHeight) ||
    !(box.width > 0) || !(box.height > 0)
  ) {
    return { ...box };
  }
  // The limiting dimension is taken from the box as-is so it stays exact
  // (no floating-point drift); only the other one is derived from the ratio.
  const boxIsWider = box.width * videoHeight > box.height * videoWidth;
  const width = boxIsWider ? (box.height * videoWidth) / videoHeight : box.width;
  const height = boxIsWider ? box.height : (box.width * videoHeight) / videoWidth;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * Converts a CSS-px rect to device pixels: multiplies by `dpr`, rounds each
 * edge to a whole pixel and clamps the result to the image bounds.
 */
export function toDevicePx(
  rect: Rect,
  dpr: number,
  imageWidth: number,
  imageHeight: number,
): Rect {
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const left = clamp(Math.round(rect.x * dpr), imageWidth);
  const top = clamp(Math.round(rect.y * dpr), imageHeight);
  const right = clamp(Math.round((rect.x + rect.width) * dpr), imageWidth);
  const bottom = clamp(Math.round((rect.y + rect.height) * dpr), imageHeight);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * True when the frame is (almost) entirely black, e.g. DRM-protected video
 * captured as a black picture. Only the central area (x 20%-80%, y 15%-60%)
 * is inspected so subtitles and player chrome do not mask a black frame.
 * An image with no inspectable pixels is not reported as blocked.
 */
export function isBlockedFrame(img: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): boolean {
  const { data, width, height } = img;
  const xStart = Math.floor(width * REGION.x0);
  const xEnd = Math.floor(width * REGION.x1);
  const yStart = Math.floor(height * REGION.y0);
  const yEnd = Math.floor(height * REGION.y1);

  let total = 0;
  let dark = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const i = (y * width + x) * 4;
      const luminance =
        0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0);
      total++;
      if (luminance < DARK_LUMINANCE) dark++;
    }
  }
  if (total === 0) return false;
  return dark / total > BLOCKED_RATIO;
}
