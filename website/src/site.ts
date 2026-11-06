export const SITE = {
  name: 'ResonNote 共鳴筆記',
  shortName: 'ResonNote',
  tagline: '這一秒打動你，就把它留下來。',
  description:
    '看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得的 Chrome 擴充功能。支援 Netflix、YouTube、Disney+，筆記只存在你的瀏覽器本機，免費開源（MIT）。',
  url: 'https://resonnote.bobochen.dev',
  repo: 'https://github.com/bobo52310/resonnote',
  author: { name: 'Bobo Chen', url: 'https://github.com/bobo52310' },
  locale: 'zh_TW',
  lang: 'zh-Hant-TW',
} as const;

export const REPO_LINKS = {
  license: `${SITE.repo}/blob/main/LICENSE`,
  issues: `${SITE.repo}/issues`,
  contributing: `${SITE.repo}/blob/main/CONTRIBUTING.md`,
  /** Always resolves to the newest release, so the site needs no edit per version. */
  releases: `${SITE.repo}/releases/latest`,
  /** GitHub's private vulnerability reporting form. */
  security: `${SITE.repo}/security/advisories/new`,
} as const;

/** Path of the privacy policy page, with the trailing slash the sitemap and canonical use. */
export const PRIVACY_PATH = '/privacy/';
