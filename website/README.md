# ResonNote 產品網站

<https://resonnote.pages.dev> 的原始碼：Astro 7 + Tailwind CSS 4 的純靜態單頁，跟擴充功能本體是各自獨立的專案（不是 pnpm workspace 成員）。

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

## 影片與圖片

- 介紹影片放 `public/media/intro.mp4`（16:9、1920×1080，無聲循環），封面是 `public/media/intro-poster.webp`（同尺寸）。build 時才判斷影片在不在：沒有影片就只顯示封面圖、不請求影片檔，所以放好影片後要重新 build（推上 git 就會重新部署）。
- 目前的 `intro-poster.webp` 是佔位圖，可直接用正式封面覆蓋。
- `public/images/`、`og.png`、favicon 由 `scripts/build-assets.sh` 從 `docs/brand/` 與宣傳影片劇照產生（需要 ImageMagick、rsvg-convert、cwebp 與 Noto Sans TC 字型），不在 `pnpm build` 裡跑。劇照是 AI 生成的原創畫面，劇名為虛構。
