import { runContentScript } from '../core/content-main';
import { createDisneyAdapter } from '../platforms/disney/adapter';
import { parseWatchVideoId } from '../platforms/disney/url';

// Disney+ is a single-page app: this script is injected on the browse pages too and lives on
// across navigation to /play/…, so the watch-page check runs when it is needed, not at load.
export default defineContentScript({
  matches: ['https://www.disneyplus.com/*'],
  main() {
    runContentScript({
      platform: 'disney',
      adapter: createDisneyAdapter(document),
      isWatchPage: () => parseWatchVideoId(location.href) !== null,
    });
  },
});
