import { describe, expect, it } from 'vitest';
import { mapNetflixMetadata } from '../../../src/platforms/netflix/metadata';

// Shape of Netflix's metadata JSON for a show (measured on a live show 2026-10-29).
const showFixture = {
  type: 'show',
  title: '新手上路',
  id: 100,
  seasons: [
    {
      seq: 1,
      episodes: [
        { id: 111, seq: 1, title: 'A' },
        { id: 112, seq: 2, title: 'B' },
      ],
    },
    { seq: 2, episodes: [{ id: 211, seq: 1, title: 'C' }] },
  ],
};

describe('mapNetflixMetadata', () => {
  it('drops an episode title that only repeats the episode number', () => {
    const generic = {
      ...showFixture,
      seasons: [{ seq: 1, episodes: [{ id: 1, seq: 2, title: '第 2 集' }, { id: 2, seq: 3, title: 'Episode 3' }] }],
    };
    expect(mapNetflixMetadata(generic, 1)).toEqual({ title: '新手上路', season: 1, episode: 2 });
    expect(mapNetflixMetadata(generic, 2)).toEqual({ title: '新手上路', season: 1, episode: 3 });
  });

  it('maps a movie to its title only', () => {
    expect(
      mapNetflixMetadata({ type: 'movie', title: '造山者－世紀的賭注', id: 83053998 }, 83053998),
    ).toEqual({ title: '造山者－世紀的賭注' });
  });

  it('maps an episode of a show to season, episode and episode title', () => {
    expect(mapNetflixMetadata(showFixture, 112)).toEqual({
      title: '新手上路',
      season: 1,
      episode: 2,
      episodeTitle: 'B',
    });
    expect(mapNetflixMetadata(showFixture, 211)).toEqual({
      title: '新手上路',
      season: 2,
      episode: 1,
      episodeTitle: 'C',
    });
  });

  it('gives only the show title when the movie id is not among the episodes', () => {
    expect(mapNetflixMetadata(showFixture, 999)).toEqual({ title: '新手上路' });
  });

  it('tolerates malformed seasons and episodes', () => {
    const odd = {
      type: 'show',
      title: 'X',
      seasons: [null, { seq: 1, episodes: 'nope' }, { seq: 2, episodes: [null, { id: 5 }] }],
    };
    expect(mapNetflixMetadata(odd, 5)).toEqual({ title: 'X', season: 2 });
  });

  it('returns null when there is no usable title', () => {
    expect(mapNetflixMetadata(undefined, 1)).toBeNull();
    expect(mapNetflixMetadata(null, 1)).toBeNull();
    expect(mapNetflixMetadata('x', 1)).toBeNull();
    expect(mapNetflixMetadata({ type: 'movie' }, 1)).toBeNull();
    expect(mapNetflixMetadata({ type: 'movie', title: '' }, 1)).toBeNull();
  });
});
