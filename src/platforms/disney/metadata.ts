import type { Playback } from '../../core/types';

type DisneySubtitle = Pick<Playback, 'season' | 'episode' | 'episodeTitle'>;

// Disney+ gives the season and episode as one localized line (`mediaPlaybackCriteria.metadata
// .subtitle.text`), never as numbers. Every pattern is anchored at the start of the line.
//
// 「第 1 季第 2 集」: the season part may be absent.
const CHINESE = /^(?:第\s*(\d{1,4})\s*季\s*)?第\s*(\d{1,4})\s*集/u;
// "Season 1 Episode 2", "season 1, episode 2", "Episode 2", "Ep. 2".
const WORDS = /^(?:season\s*(\d{1,4})\s*[,，:：·\-–—]?\s*)?ep(?:isode)?\.?\s*(\d{1,4})(?!\d)/iu;
// "S1:E2", "S1 E2" - the letters follow the interface language (seen: S2:E3, S2:O3, Ř22:D10).
const MARKERS = /^\p{L}{1,3}\s*(\d{1,4})\s*[:：]?\s*\p{L}{1,3}\s*(\d{1,4})(?!\d)/u;

/** Separators between the episode marker and the episode title. */
const TITLE_LEAD = /^[\s:：\-–—·]+/;
/** An episode title that only repeats the episode number says nothing the heading does not. */
const GENERIC_EPISODE_TITLE = /^(?:第\s*\d+\s*集|episode\s*\d+|ep\.?\s*\d+)$/i;

/**
 * Reads season, episode and episode title out of the line Disney+ shows under the title, for
 * example 「第 1 季第 2 集：集名」 or `S1:E2 Title`. A movie has no such line (`''` gives `{}`).
 * When no marker is recognised the whole line is taken as the episode title.
 */
export function parseDisneySubtitle(text: string): DisneySubtitle {
  const line = text.trim();
  if (line === '') return {};

  const found = CHINESE.exec(line) ?? WORDS.exec(line) ?? MARKERS.exec(line);
  if (found === null) return { episodeTitle: line };
  const [matched, season, episode] = found;

  const result: DisneySubtitle = {};
  if (season !== undefined) result.season = Number(season);
  if (episode !== undefined) result.episode = Number(episode);

  const episodeTitle = line.slice(matched.length).replace(TITLE_LEAD, '').trim();
  if (episodeTitle !== '' && !GENERIC_EPISODE_TITLE.test(episodeTitle)) {
    result.episodeTitle = episodeTitle;
  }
  return result;
}
