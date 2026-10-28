import { isBlockedFrame, toDevicePx } from './capture-math';
import { bytesToDataUrl, dataUrlToBytes } from './messages';
import type { Rect } from './types';

/** Output quality of the cropped screenshot (global constraint: JPEG 0.9). */
const JPEG_QUALITY = 0.9;

export interface CropResult {
  dataUrl: string;
  width: number;
  height: number;
  /** True when the picture is unusable: a black (DRM-blocked) frame, or a crop area outside the image. */
  blocked: boolean;
}

/**
 * Crops a full-tab screenshot (JPEG data URL) to the video picture and checks whether it
 * came out black. `cssRect` is in CSS px; `dpr` converts it to the screenshot's pixels.
 * A crop area with no pixels in it is reported as `blocked` with an empty `dataUrl` and 0x0 size.
 * Browser-only (createImageBitmap / OffscreenCanvas), so it has no unit test.
 */
export async function cropAndCheck(
  dataUrl: string,
  cssRect: Rect,
  dpr: number,
): Promise<CropResult> {
  const bitmap = await createImageBitmap(new Blob([dataUrlToBytes(dataUrl)], { type: 'image/jpeg' }));
  try {
    const area = toDevicePx(cssRect, dpr, bitmap.width, bitmap.height);
    if (area.width === 0 || area.height === 0) {
      return { dataUrl: '', width: 0, height: 0, blocked: true };
    }
    const canvas = new OffscreenCanvas(area.width, area.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) throw new Error('2d canvas context is unavailable');
    context.drawImage(bitmap, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);
    const blocked = isBlockedFrame(context.getImageData(0, 0, area.width, area.height));
    const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    return {
      dataUrl: bytesToDataUrl(new Uint8Array(await jpeg.arrayBuffer())),
      width: area.width,
      height: area.height,
      blocked,
    };
  } finally {
    bitmap.close();
  }
}

/** Wraps JPEG bytes (e.g. a scrubber preview) as a data URL and reads the picture's size. */
export async function jpegBytesToDataUrl(
  bytes: Uint8Array,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: 'image/jpeg' }));
  try {
    return { dataUrl: bytesToDataUrl(bytes), width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}
