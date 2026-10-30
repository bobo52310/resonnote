import { runContentScript } from '../core/content-main';
import { createYouTubeAdapter, findPlayer, isAdShowing } from '../platforms/youtube/adapter';
import { parseWatchVideoId } from '../platforms/youtube/url';

// YouTube is a single-page app: this script is injected on the home page too and lives on across
// navigation to /watch, /shorts/ and /live/, so the watch-page check runs when it is needed, not at load.
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  main() {
    runContentScript({
      platform: 'youtube',
      adapter: createYouTubeAdapter(document),
      // Nothing to note during an ad (its time and picture are not the video's), so the button stays
      // away until the video itself plays.
      watchVideoId: () => (isAdShowing(document) ? null : parseWatchVideoId(location.href)),
      // The player is not full-window in the default and theater layouts, so the button sits on it.
      quickButtonAnchor: () => findPlayer(document),
    });
  },
});
