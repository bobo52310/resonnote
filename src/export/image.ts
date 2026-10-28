const BASE64_CHUNK = 0x8000;

/** Output size for fitting `width` x `height` into `maxWidth`; never enlarges. */
export function scaledSize(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth) return { width, height };
  const scale = maxWidth / width;
  return { width: maxWidth, height: Math.max(1, Math.round(height * scale)) };
}

/** Base64 of `bytes`, built in chunks so large images do not overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

/**
 * Browser only. Returns `data:image/jpeg;base64,...` for the JPEG in `bytes`, shrunk to at
 * most `maxWidth` px wide (quality 0.9). An image that is already narrow enough is returned
 * untouched, without re-encoding.
 */
export async function downscaleJpeg(bytes: ArrayBuffer, maxWidth: number): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  try {
    if (bitmap.width <= maxWidth) {
      return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(bytes))}`;
    }
    const size = scaledSize(bitmap.width, bitmap.height, maxWidth);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d canvas context unavailable');
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  } finally {
    bitmap.close();
  }
}
