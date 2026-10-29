import type { Playback } from '../../core/types';

type NetflixMeta = Pick<Playback, 'title' | 'season' | 'episode' | 'episodeTitle'>;

const GENERIC_EPISODE_TITLE = /^\s*(第\s*\d+\s*集|episode\s*\d+)\s*$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sameId(value: unknown, id: number): boolean {
  return value === id || (typeof value === 'string' && value !== '' && Number(value) === id);
}

/**
 * Maps Netflix's `videoMetadata[id]._metadata.video` object to the fields a note needs.
 * A movie gives just `title`. For a show, the season/episode that contains `movieId` add
 * `season`, `episode` and `episodeTitle`; a show title alone is returned when `movieId` is not
 * found among them. The show shape (`seasons[].seq`, `seasons[].episodes[].{id,seq,title}`)
 * is an assumption — only movies have been measured on a live player.
 * Returns `null` when there is no usable title.
 */
export function mapNetflixMetadata(video: unknown, movieId: number): NetflixMeta | null {
  if (!isRecord(video)) return null;
  const title = video['title'];
  if (typeof title !== 'string' || title === '') return null;

  const result: NetflixMeta = { title };
  const seasons = video['seasons'];
  if (!Array.isArray(seasons)) return result;

  for (const season of seasons) {
    if (!isRecord(season) || !Array.isArray(season['episodes'])) continue;
    const episode = season['episodes'].find(
      (candidate: unknown) => isRecord(candidate) && sameId(candidate['id'], movieId),
    );
    if (!isRecord(episode)) continue;

    const seasonNumber = asNumber(season['seq']);
    const episodeNumber = asNumber(episode['seq']);
    const episodeTitle = episode['title'];
    if (seasonNumber !== undefined) result.season = seasonNumber;
    if (episodeNumber !== undefined) result.episode = episodeNumber;
    // Many shows name their episodes just 「第 2 集」/「Episode 2」, which the heading already says.
    if (typeof episodeTitle === 'string' && episodeTitle !== '' && !GENERIC_EPISODE_TITLE.test(episodeTitle)) {
      result.episodeTitle = episodeTitle;
    }
    break;
  }
  return result;
}
