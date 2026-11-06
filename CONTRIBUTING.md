# 貢獻指南

謝謝你有興趣參與 ResonNote。小修正可以直接開 PR；比較大的改動（新功能、新平台）請先開 issue 討論方向。

## 開發環境

- Node.js 22.12 以上（或 24）、pnpm（版本以 `package.json` 的 `packageManager` 為準）。
- `pnpm install` 安裝相依套件，`pnpm dev` 啟動 WXT 開發模式，`pnpm build` 的輸出在 `.output/chrome-mv3`，用 Chrome 的「載入未封裝項目」載入。

## 送 PR 之前

下面三個指令都要全過：

```sh
pnpm test      # Vitest
pnpm compile   # tsc --noEmit
pnpm build
```

- 程式碼、註解、commit 訊息用英文；使用者看得到的文字與 README 用繁體中文（zh-TW）。
- commit 訊息用英文 [Conventional Commits](https://www.conventionalcommits.org/)，例如 `fix(youtube): ignore ads when reading the playhead`。
- 行為改動請附測試，測試放在 `tests/`。
- PR 說明請寫清楚：改了什麼、為什麼、**在哪個平台（Netflix、YouTube、Disney+）手動測過**。沒辦法實測的平台也請直接寫明。
- 請勿在 issue、PR 或測資裡貼受版權保護的截圖或台詞；需要重現時，描述步驟即可。

## 新增平台支援

各平台的轉接層放在 `src/platforms/` 底下，一個平台一個資料夾（可參考 `netflix/`、`youtube/`、`disney/`），並在 `src/platforms/registry.ts` 註冊。大方向：

1. 在 `src/platforms/<平台>/` 實作網址判斷、片名／秒數／台詞的讀取，以及暫停、播放、跳秒。
2. 在 `src/entrypoints/` 加上該平台的內容腳本，並在 `wxt.config.ts` 補上網站權限。
3. 每一項讀不到時都要有退路：少一項，不要讓整個記錄流程中斷。
4. 補上對應的測試，並在 README 的「已知限制」寫下這個平台的退路與限制。

## 回報問題與安全性

一般問題請用 issue 範本回報；安全性問題請看 [SECURITY.md](SECURITY.md)，不要開公開 issue。
