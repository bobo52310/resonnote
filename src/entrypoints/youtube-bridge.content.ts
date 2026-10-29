import { installPageBridge } from '../platforms/youtube/page-bridge';

// Runs in the page's own JS world: the player's methods are not visible from the isolated world.
export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    installPageBridge(window);
  },
});
