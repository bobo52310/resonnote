import { runContentScript } from '../core/content-main';
import { createNetflixAdapter } from '../platforms/netflix/adapter';
import { parseWatchVideoId } from '../platforms/netflix/url';

// Netflix is a single-page app: this script is injected on /browse too and lives on across
// navigation to /watch/…, so the watch-page check runs when it is needed, not at load.
export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  main() {
    runContentScript({
      platform: 'netflix',
      adapter: createNetflixAdapter(document),
      isWatchPage: () => parseWatchVideoId(location.href) !== null,
    });
  },
});
