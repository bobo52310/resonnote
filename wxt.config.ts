import { defineConfig, type UserManifest, type WxtViteConfig } from 'wxt';

/**
 * Build mode of the Chrome Web Store package (`pnpm zip:store`). It is a normal
 * production build; the mode only decides whether the manifest carries `key`.
 */
export const STORE_MODE = 'store';

// Public key behind the fixed extension ID `bldeoidbgkcdnmiholglmknnimdhnhff`.
export const EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo4Dw2v8zjMck3AvC79EkKgSQFF9PGJV6MYrryz4/RIyya8t++NHn0848GxGgSJvH1tKM0D+40KKwkCwo34yUlaCtWIX/FkLNsWfCWsz/lTRdgGp+3605ci7z6aPoD2kx5vmqkhejrpwQ3LFKfU62MClCao030F1Wo4M3p07wfvv+c8JCduYg2iIEhRT+/UrxNyBKbJtK56xcgu/M7q232sVK5kE2I4+Qb3iJXpN6GdUZHuml9NB4D+v2Tkspv5SUHv3O/kvf3KPGUO4Kz/Yyhvvquevxuxg2P6kJJjUMYYYO32cYhJiKZBlTwkDmD3XbfzPs8WgI75SwnO8cDbQnSQIDAQAB';

export function createManifest(mode: string): UserManifest {
  return {
    // Fixed public key so the extension ID stays the same wherever the folder lives.
    // Left out of the store package (issue #2): the Chrome Web Store assigns its own
    // ID, so that package must not carry a key.
    ...(mode === STORE_MODE ? {} : { key: EXTENSION_KEY }),
    name: 'ResonNote 共鳴筆記',
    short_name: 'ResonNote',
    description: '看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得（支援 Netflix、YouTube、Disney+）',
    permissions: ['activeTab', 'storage', 'unlimitedStorage'],
    host_permissions: [
      'https://www.netflix.com/*',
      'https://www.youtube.com/*',
      'https://www.disneyplus.com/*',
    ],
    action: { default_title: '記下這一刻（ResonNote）' },
    commands: {
      'capture-scene': {
        suggested_key: { default: 'Alt+Shift+N', mac: 'Alt+Shift+N' },
        description: '記下這一刻',
      },
    },
  };
}

export function createViteConfig(mode: string): WxtViteConfig {
  // WXT silences its runtime logger only when import.meta.env.MODE is 'production'.
  // Pin it for the store build so the code is identical to `pnpm build`.
  if (mode !== STORE_MODE) return {};
  return { define: { 'import.meta.env.MODE': JSON.stringify('production') } };
}

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  srcDir: 'src',
  manifest: ({ mode }) => createManifest(mode),
  vite: ({ mode }) => createViteConfig(mode),
});
