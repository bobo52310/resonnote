# ResonNote 產品網站

<https://resonnote.bobochen.dev> 的原始碼：Astro 7 + Tailwind CSS 4 的純靜態網站（首頁加 `/privacy/` 隱私權政策頁），跟擴充功能本體是各自獨立的專案（不是 pnpm workspace 成員）。

## 本機開發

```sh
cd website
pnpm install
pnpm dev       # http://localhost:4321
pnpm build     # 輸出到 dist/
pnpm preview   # 預覽 dist/
pnpm check     # astro check（型別與 .astro 檢查）
```

## Cloudflare Pages（原生 git integration，不用 adapter）

- Root directory：`website`
- Build command：`pnpm install --frozen-lockfile && pnpm build`
- Build output directory：`dist`
- 環境變數：`NODE_VERSION=24`、`PNPM_VERSION=12.10.1`
- `public/_headers` 會原樣部署（安全標頭與 `/_astro/*` 長快取）。
- 網址是自訂網域 `resonnote.bobochen.dev`（在 Cloudflare Pages 專案的 Custom domains 綁定）；換網域時要同步改 `astro.config.mjs` 的 `site`、`src/site.ts` 的 `url` 與 `public/robots.txt`。
- 安裝區塊的下載連結指向 `releases/latest`，發新版不用改網站。
- 隱私權政策（`src/pages/privacy.astro`）的內容要跟根目錄 README 的「隱私」段與程式碼一致；擴充功能的權限或網路請求有變時一起更新，並改頁內的生效日期。

## 影片與圖片

- 介紹影片放 `public/media/intro.mp4`（16:9、1920×1080，無聲循環），封面是 `public/media/intro-poster.webp`（同尺寸）。build 時才判斷影片在不在：沒有影片就只顯示封面圖、不請求影片檔，所以放好影片後要重新 build（推上 git 就會重新部署）。
- 目前的 `intro-poster.webp` 是佔位圖，可直接用正式封面覆蓋。
- `public/images/`、`og.png`、favicon 由 `scripts/build-assets.sh` 從 `docs/brand/` 與宣傳影片劇照產生（需要 ImageMagick、rsvg-convert、cwebp 與 Noto Sans TC 字型），不在 `pnpm build` 裡跑。劇照是 AI 生成的原創畫面，劇名為虛構。
