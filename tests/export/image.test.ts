import { describe, expect, it } from 'vitest';
import { bytesToBase64, scaledSize } from '../../src/export/image';

describe('scaledSize', () => {
  it('shrinks to the max width keeping the aspect ratio', () => {
    expect(scaledSize(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('never enlarges an image that is already narrow enough', () => {
    expect(scaledSize(640, 360, 1280)).toEqual({ width: 640, height: 360 });
    expect(scaledSize(1280, 720, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('keeps at least one pixel of height', () => {
    expect(scaledSize(10000, 1, 100).height).toBe(1);
  });
});

describe('bytesToBase64', () => {
  it('encodes small input', () => {
    expect(bytesToBase64(new Uint8Array([72, 105]))).toBe('SGk=');
  });

  it('matches btoa for input larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    expect(bytesToBase64(bytes)).toBe(btoa(binary));
  });
});
