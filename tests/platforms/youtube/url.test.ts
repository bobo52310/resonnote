import { describe, expect, it } from 'vitest';
import { parseWatchVideoId, watchUrl } from '../../../src/platforms/youtube/url';

const ID = 'arj7oStGLkU';

describe('watchUrl', () => {
  it('links to the watch page at the floored second', () => {
    expect(watchUrl(ID, 1_003_469)).toBe(`https://www.youtube.com/watch?v=${ID}&t=1003s`);
  });

  it('uses t=0s for zero, negative or non-finite times', () => {
    expect(watchUrl(ID, 0)).toBe(`https://www.youtube.com/watch?v=${ID}&t=0s`);
    expect(watchUrl(ID, -5)).toBe(`https://www.youtube.com/watch?v=${ID}&t=0s`);
    expect(watchUrl(ID, Number.NaN)).toBe(`https://www.youtube.com/watch?v=${ID}&t=0s`);
  });

  it('keeps a Shorts or live id working as a normal watch link', () => {
    expect(watchUrl('a-b_c1D2e3F', 60_000)).toBe('https://www.youtube.com/watch?v=a-b_c1D2e3F&t=60s');
  });

  it('cannot be bent into another parameter or path by an odd id (ids come from backup files)', () => {
    expect(watchUrl('x&t=9#', 1000)).toBe('https://www.youtube.com/watch?v=x%26t%3D9%23&t=1s');
  });

  it('round-trips with parseWatchVideoId', () => {
    expect(parseWatchVideoId(watchUrl(ID, 90_000))).toBe(ID);
  });
});

describe('parseWatchVideoId', () => {
  it('reads the id from /watch?v=, ignoring the other parameters and the fragment', () => {
    expect(parseWatchVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.youtube.com/watch?v=${ID}&t=60s&list=PL123#x`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.youtube.com/watch?list=PL123&v=${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it('reads the id from /shorts/ and /live/ pages', () => {
    expect(parseWatchVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.youtube.com/shorts/${ID}/`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.youtube.com/shorts/${ID}?feature=share`)).toBe(ID);
    expect(parseWatchVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(parseWatchVideoId(`https://youtube.com/live/${ID}?si=abc`)).toBe(ID);
  });

  it('accepts every character an id may hold', () => {
    expect(parseWatchVideoId('https://www.youtube.com/watch?v=a-b_c1D2e3F')).toBe('a-b_c1D2e3F');
    expect(parseWatchVideoId('https://www.youtube.com/shorts/-_-_-_-_-_-')).toBe('-_-_-_-_-_-');
  });

  it('rejects ids that are not exactly 11 characters of [A-Za-z0-9_-]', () => {
    expect(parseWatchVideoId('https://www.youtube.com/watch?v=')).toBeNull();
    expect(parseWatchVideoId('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com/watch?v=${ID}x`)).toBeNull();
    expect(parseWatchVideoId('https://www.youtube.com/watch?v=arj7oStGLk!')).toBeNull();
    expect(parseWatchVideoId('https://www.youtube.com/shorts/short')).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com/shorts/${ID}x`)).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com/live/${ID}/extra`)).toBeNull();
  });

  it('rejects pages that are not a video page', () => {
    expect(parseWatchVideoId('https://www.youtube.com/')).toBeNull();
    expect(parseWatchVideoId('https://www.youtube.com/watch')).toBeNull();
    expect(parseWatchVideoId('https://www.youtube.com/results?search_query=cats')).toBeNull();
    expect(parseWatchVideoId('https://www.youtube.com/feed/subscriptions')).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com/@channel/watch?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com/playlist?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com/embed/${ID}`)).toBeNull();
  });

  it('rejects the other YouTube hosts and look-alike hosts', () => {
    expect(parseWatchVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://music.youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://youtu.be/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://evil.example/?u=https://www.youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`http://www.youtube.com/watch?v=${ID}`)).toBeNull();
    expect(parseWatchVideoId(`https://www.youtube.com:8443/watch?v=${ID}`)).toBeNull();
  });

  it('rejects things that are not URLs', () => {
    expect(parseWatchVideoId('not a url')).toBeNull();
    expect(parseWatchVideoId('')).toBeNull();
    expect(parseWatchVideoId(undefined)).toBeNull();
  });
});
