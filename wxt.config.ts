import { defineConfig } from 'wxt';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  srcDir: 'src',
  manifest: {
    // Fixed public key so the extension ID stays the same wherever the folder lives.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo4Dw2v8zjMck3AvC79EkKgSQFF9PGJV6MYrryz4/RIyya8t++NHn0848GxGgSJvH1tKM0D+40KKwkCwo34yUlaCtWIX/FkLNsWfCWsz/lTRdgGp+3605ci7z6aPoD2kx5vmqkhejrpwQ3LFKfU62MClCao030F1Wo4M3p07wfvv+c8JCduYg2iIEhRT+/UrxNyBKbJtK56xcgu/M7q232sVK5kE2I4+Qb3iJXpN6GdUZHuml9NB4D+v2Tkspv5SUHv3O/kvf3KPGUO4Kz/Yyhvvquevxuxg2P6kJJjUMYYYO32cYhJiKZBlTwkDmD3XbfzPs8WgI75SwnO8cDbQnSQIDAQAB',
    name: 'ResonNote 共鳴筆記',
    short_name: 'ResonNote',
    description: '看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得（支援 Netflix）',
    permissions: ['activeTab', 'storage', 'unlimitedStorage'],
    host_permissions: ['https://www.netflix.com/*'],
    action: { default_title: '記下這一刻（ResonNote）' },
    commands: {
      'capture-scene': {
        suggested_key: { default: 'Alt+Shift+N', mac: 'Alt+Shift+N' },
        description: '記下這一刻',
      },
    },
  },
});
