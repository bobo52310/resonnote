import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { createManifest, createViteConfig, EXTENSION_KEY, STORE_MODE } from '../../wxt.config';

// The ID that notes written by unpacked and GitHub Release installs are tied to.
const FIXED_EXTENSION_ID = 'bldeoidbgkcdnmiholglmknnimdhnhff';

/** Chrome derives the extension ID from the first 16 bytes of SHA-256(public key). */
function extensionIdFromKey(key: string): string {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode('a'.charCodeAt(0) + nibble))
    .join('');
}

const { scripts } = pkg as { scripts: Record<string, string> };

describe('manifest key', () => {
  it('is the key behind the fixed extension ID', () => {
    expect(extensionIdFromKey(EXTENSION_KEY)).toBe(FIXED_EXTENSION_ID);
  });

  it.each(['production', 'development', 'staging'])('is included in %s mode', (mode) => {
    expect(createManifest(mode).key).toBe(EXTENSION_KEY);
  });

  it('is left out of the store build', () => {
    expect(createManifest(STORE_MODE)).not.toHaveProperty('key');
  });

  it('is the only difference between the store build and the normal build', () => {
    const { key, ...withoutKey } = createManifest('production');
    expect(key).toBe(EXTENSION_KEY);
    expect(createManifest(STORE_MODE)).toStrictEqual(withoutKey);
  });
});

describe('store build', () => {
  it('pins import.meta.env.MODE to production so the code matches `pnpm build`', () => {
    expect(createViteConfig(STORE_MODE)).toStrictEqual({
      define: { 'import.meta.env.MODE': '"production"' },
    });
  });

  it('leaves the vite config alone for every other mode', () => {
    expect(createViteConfig('production')).toStrictEqual({});
    expect(createViteConfig('development')).toStrictEqual({});
  });

  it('is what the store scripts in package.json build', () => {
    expect(scripts['build:store']).toBe(`wxt build --mode ${STORE_MODE}`);
    expect(scripts['zip:store']).toBe(`wxt zip --mode ${STORE_MODE}`);
  });

  it('is not what the normal scripts build', () => {
    expect(scripts.build).toBe('wxt build');
    expect(scripts.zip).toBe('wxt zip');
  });
});
