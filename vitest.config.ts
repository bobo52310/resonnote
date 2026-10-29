import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['fake-indexeddb/auto'],
    // Agent worktrees live under .claude/worktrees/ and carry their own copy of the tests.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
