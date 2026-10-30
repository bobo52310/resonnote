import { installPageBridge } from '../platforms/disney/page-bridge';

// Runs in the page's own JS world: Disney+'s player API is not visible from the isolated world.
export default defineContentScript({
  matches: ['https://www.disneyplus.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    installPageBridge(window);
  },
});
