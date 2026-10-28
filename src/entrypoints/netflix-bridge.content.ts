import { installPageBridge } from '../platforms/netflix/page-bridge';

// Runs in the page's own JS world: Netflix's player API is not visible from the isolated world.
export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    installPageBridge(window);
  },
});
