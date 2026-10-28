import { describe, expect, it } from 'vitest';
import { parseWatchVideoId, watchUrl } from '../../../src/platforms/netflix/url';

describe('watchUrl', () => {
  it('links to the watch page at the floored second', () => {
    expect(watchUrl('83053998', 1003469)).toBe('https://www.netflix.com/watch/83053998?t=1003');
  });

  it('uses t=0 for zero, negative or non-finite times', () => {
    expect(watchUrl('1', 0)).toBe('https://www.netflix.com/watch/1?t=0');
    expect(watchUrl('1', -5)).toBe('https://www.netflix.com/watch/1?t=0');
    expect(watchUrl('1', Number.NaN)).toBe('https://www.netflix.com/watch/1?t=0');
  });
});

describe('parseWatchVideoId', () => {
  it('reads the id from a watch URL, ignoring query and fragment', () => {
    expect(parseWatchVideoId('https://www.netflix.com/watch/83053998?t=5')).toBe('83053998');
    expect(parseWatchVideoId('https://www.netflix.com/watch/83053998')).toBe('83053998');
    expect(parseWatchVideoId('https://www.netflix.com/watch/83053998/?trackId=1#x')).toBe('83053998');
  });

  it('rejects everything that is not a numeric watch URL on www.netflix.com over https', () => {
    expect(parseWatchVideoId('https://www.netflix.com/browse')).toBeNull();
    expect(parseWatchVideoId('https://www.netflix.com/watch/abc')).toBeNull();
    expect(parseWatchVideoId('https://www.netflix.com/watch/')).toBeNull();
    expect(parseWatchVideoId('https://www.netflix.com/watch/123/extra')).toBeNull();
    expect(parseWatchVideoId('http://www.netflix.com/watch/123')).toBeNull();
    expect(parseWatchVideoId('https://netflix.com/watch/123')).toBeNull();
    expect(parseWatchVideoId('https://www.netflix.com.evil.example/watch/123')).toBeNull();
    expect(parseWatchVideoId('https://evil.example/?u=https://www.netflix.com/watch/123')).toBeNull();
    expect(parseWatchVideoId('not a url')).toBeNull();
    expect(parseWatchVideoId('')).toBeNull();
    expect(parseWatchVideoId(undefined)).toBeNull();
  });
});
