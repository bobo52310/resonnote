import { describe, expect, it } from 'vitest';
import { parseDisneySubtitle } from '../../../src/platforms/disney/metadata';

describe('parseDisneySubtitle', () => {
  it('reads 「第 1 季第 2 集：集名」 with or without spaces and with either colon', () => {
    const expected = { season: 1, episode: 2, episodeTitle: '集名' };
    expect(parseDisneySubtitle('第 1 季第 2 集：集名')).toEqual(expected);
    expect(parseDisneySubtitle('第1季第2集：集名')).toEqual(expected);
    expect(parseDisneySubtitle('第 1 季 第 2 集: 集名')).toEqual(expected);
    expect(parseDisneySubtitle('第1季第2集 集名')).toEqual(expected);
    expect(parseDisneySubtitle('第1季第2集集名')).toEqual(expected);
  });

  it('drops an episode title that only repeats the episode number (the measured case)', () => {
    expect(parseDisneySubtitle('第 1 季第 2 集：第2集')).toEqual({ season: 1, episode: 2 });
    expect(parseDisneySubtitle('第 1 季第 2 集：第 2 集')).toEqual({ season: 1, episode: 2 });
    expect(parseDisneySubtitle('第 1 季第 2 集：Episode 2')).toEqual({ season: 1, episode: 2 });
    expect(parseDisneySubtitle('第 1 季第 2 集：Ep. 2')).toEqual({ season: 1, episode: 2 });
    expect(parseDisneySubtitle('S1:E2 episode 2')).toEqual({ season: 1, episode: 2 });
    // Only a title that is nothing but the number is generic.
    expect(parseDisneySubtitle('S1:E2 Episode 2: The Return')).toEqual({
      season: 1,
      episode: 2,
      episodeTitle: 'Episode 2: The Return',
    });
  });

  it('reads an episode without a season', () => {
    expect(parseDisneySubtitle('第 5 集：重逢')).toEqual({ episode: 5, episodeTitle: '重逢' });
    expect(parseDisneySubtitle('Episode 5 Reunion')).toEqual({ episode: 5, episodeTitle: 'Reunion' });
  });

  it('reads S1:E2 style markers, whatever letters the interface language uses', () => {
    expect(parseDisneySubtitle('S1:E2 集名')).toEqual({ season: 1, episode: 2, episodeTitle: '集名' });
    expect(parseDisneySubtitle('S2:E3 Chapter 11: The Heiress')).toEqual({
      season: 2,
      episode: 3,
      episodeTitle: 'Chapter 11: The Heiress',
    });
    expect(parseDisneySubtitle('S2:O3 Rozdział 11')).toEqual({
      season: 2,
      episode: 3,
      episodeTitle: 'Rozdział 11',
    });
    expect(parseDisneySubtitle('Ř22:D10 Záhada nad Středozemním mořem')).toEqual({
      season: 22,
      episode: 10,
      episodeTitle: 'Záhada nad Středozemním mořem',
    });
    expect(parseDisneySubtitle('s1:e2 lower case')).toEqual({ season: 1, episode: 2, episodeTitle: 'lower case' });
  });

  it('reads S1 E2 and S1:E2 without a title', () => {
    expect(parseDisneySubtitle('S1 E2')).toEqual({ season: 1, episode: 2 });
    expect(parseDisneySubtitle('S1:E2')).toEqual({ season: 1, episode: 2 });
    expect(parseDisneySubtitle('S1E2 集名')).toEqual({ season: 1, episode: 2, episodeTitle: '集名' });
    expect(parseDisneySubtitle('S10:E123')).toEqual({ season: 10, episode: 123 });
  });

  it('reads "Season 1 Episode 2" in any case, with several ways to separate the title', () => {
    expect(parseDisneySubtitle('Season 1 Episode 2 集名')).toEqual({ season: 1, episode: 2, episodeTitle: '集名' });
    expect(parseDisneySubtitle('SEASON 3, EPISODE 4: Foo')).toEqual({ season: 3, episode: 4, episodeTitle: 'Foo' });
    expect(parseDisneySubtitle('season 1 episode 2 - Foo')).toEqual({ season: 1, episode: 2, episodeTitle: 'Foo' });
    expect(parseDisneySubtitle('Season 1 Episode 2 · Foo')).toEqual({ season: 1, episode: 2, episodeTitle: 'Foo' });
    expect(parseDisneySubtitle('Season 1 Episode 2')).toEqual({ season: 1, episode: 2 });
  });

  it('strips separators in front of the episode title', () => {
    for (const separator of [':', '：', '-', '–', '—', '·', ' : ', ' - ']) {
      expect(parseDisneySubtitle(`S1:E2${separator}Title`)).toEqual({ season: 1, episode: 2, episodeTitle: 'Title' });
    }
  });

  it('gives {} for the empty line a movie has', () => {
    expect(parseDisneySubtitle('')).toEqual({});
    expect(parseDisneySubtitle('   ')).toEqual({});
  });

  it('takes a line it cannot read as the episode title', () => {
    expect(parseDisneySubtitle('Bonus: Behind the scenes')).toEqual({ episodeTitle: 'Bonus: Behind the scenes' });
    expect(parseDisneySubtitle('  花絮  ')).toEqual({ episodeTitle: '花絮' });
    // Not a marker: no number straight after the letters.
    expect(parseDisneySubtitle('Top 10 Moments 5')).toEqual({ episodeTitle: 'Top 10 Moments 5' });
  });
});
