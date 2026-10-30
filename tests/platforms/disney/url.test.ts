import { describe, expect, it } from 'vitest';
import { parseWatchVideoId, watchUrl } from '../../../src/platforms/disney/url';

const ID = '4b3a1c2e-9f00-4d6b-8a21-0123456789ab';

describe('watchUrl', () => {
  it('links to the play page without a time (Disney+ has no such parameter)', () => {
    expect(watchUrl(ID)).toBe(`https://www.disneyplus.com/play/${ID}`);
  });

  it('ignores the moment even when a caller passes one', () => {
    const link = (watchUrl as (videoId: string, timeMs: number) => string)(ID, 600_000);
    expect(link).toBe(`https://www.disneyplus.com/play/${ID}`);
  });

  it('cannot be bent into another path by an odd id (ids come from backup files)', () => {
    expect(watchUrl('../browse?x=1')).toBe('https://www.disneyplus.com/play/..%2Fbrowse%3Fx%3D1');
  });

  it('round-trips with parseWatchVideoId', () => {
    expect(parseWatchVideoId(watchUrl(ID))).toBe(ID);
  });
});

describe('parseWatchVideoId', () => {
  it('reads the id from /play/<uuid> with or without a locale segment', () => {
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/zh-hant/play/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/en-gb/play/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/pt-br/play/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/ja/play/${ID}`)).toBe(ID);
  });

  it('also reads the older /video/<uuid> form', () => {
    expect(parseWatchVideoId(`https://www.disneyplus.com/video/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/zh-hant/video/${ID}`)).toBe(ID);
  });

  it('ignores a trailing slash, the query string and the fragment', () => {
    expect(parseWatchVideoId(`https://www.disneyplus.com/zh-hant/play/${ID}/`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID}?action=playback#x`)).toBe(ID);
  });

  it('accepts an upper-case UUID and returns it in lower case', () => {
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID.toUpperCase()}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.disneyplus.com/zh-hant/video/${ID.toUpperCase()}`)).toBe(ID);
  });

  it('rejects ids that are not a UUID', () => {
    expect(parseWatchVideoId('https://www.disneyplus.com/play/')).toBeNull();
    expect(parseWatchVideoId('https://www.disneyplus.com/play/abc')).toBeNull();
    expect(parseWatchVideoId('https://www.disneyplus.com/play/4b3a1c2e9f004d6b8a210123456789ab')).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID}0`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID.slice(0, -1)}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID.replace('a', 'g')}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/play/${ID}/extra`)).toBeNull();
  });

  it('rejects pages that are not a play page', () => {
    expect(parseWatchVideoId('https://www.disneyplus.com/')).toBeNull();
    expect(parseWatchVideoId('https://www.disneyplus.com/zh-hant/home')).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/browse/entity-${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/zh-hant/browse/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/series/some-show/${ID}`)).toBeNull();
  });

  it('rejects a locale segment that is not one, and nested prefixes', () => {
    expect(parseWatchVideoId(`https://www.disneyplus.com/z/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/zhh/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/zh-hantxx/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com/a/b/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com//play/${ID}`)).toBeNull();
  });

  it('rejects other domains, look-alike hosts and other schemes', () => {
    expect(parseWatchVideoId(`https://disneyplus.com/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.hotstar.com/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.disneyplus.com.evil.example/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://evil.example/?u=https://www.disneyplus.com/play/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`http://www.disneyplus.com/play/${ID}`)).toBeNull();
  });

  it('rejects things that are not URLs', () => {
    expect(parseWatchVideoId('not a url')).toBeNull();
    expect(parseWatchVideoId('')).toBeNull();
    expect(parseWatchVideoId(undefined)).toBeNull();
  });
});
