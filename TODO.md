# TODO — scenenote

> 2026-10-28：v1 程式完成（431 項自動測試通過）。2026-10-29 已合併進 `main`，並推上 GitHub private repo：https://github.com/bobo52310/scenenote
>
> 2026-10-29（晚）：v1.1 加上 YouTube 與 Disney+，程式完成，在 `feat/youtube-disney` 分支，尚未合併、尚未推上去（872 項自動測試通過、`pnpm compile` 無錯；真網站上用注入內容腳本的方式驗過，沒有載入真正的擴充功能）。設計見 `docs/superpowers/specs/2026-10-29-youtube-disney-design.md`。

## 🔴 下一步

- [ ] `pnpm build` 後在 `chrome://extensions` 重新載入擴充功能、重新整理已開著的 Netflix／YouTube／Disney+ 分頁，照 `docs/acceptance-2026-10-29-youtube-disney.md` 跑一遍（約 20 分鐘），逐項勾通過／不通過
- [ ] 照 `docs/acceptance-2026-10-28.md` 在真的 Netflix 上跑一遍 v1 驗收，逐項勾通過／不通過（v1.1 清單的第 13、19 項只是 Netflix 回歸，不能取代這份）
- [ ] v1.1 驗收通過後，把 `feat/youtube-disney` 合併進 `main`（要推上 GitHub 再說）
- [x] Disney+、YouTube 轉接層（v1.1，2026-10-29；在 `feat/youtube-disney` 分支）
- [x] 合併進 `main`（2026-10-29）
- [x] 建 GitHub private repo 並推上去（2026-10-29）
- [x] 回 Notion「22 DB Side Project Ideas」的 scenenote 卡片補 GitHub 欄（2026-10-29）

## 只有實機能確認的事

- 影集的季、集在 Netflix metadata 裡的結構（目前是假設，見 spec §10）
- 截圖被擋時，真正的 BIF 檔能不能解析（只用自己組的測試檔驗過）
- 全螢幕時按 Esc：Chrome 會先退出全螢幕，小視窗可能要按第二次才取消
- 注音輸入法選字的 Enter 不會提早存檔（程式把 keyCode 229 視為選字中）

## v1.1 只有實機能確認的事（YouTube、Disney+）

- 載入真的擴充功能後，在 YouTube、Disney+ 用快捷鍵做分頁截圖與裁切（`captureVisibleTab`），字幕有沒有入鏡、邊緣有沒有多一條線
- YouTube 一般模式下，按鈕還浮在畫面上時按快捷鍵，按鈕會不會被拍進縮圖：按鈕掛在網頁最外層，截圖前隱藏控制列只動播放器的子元素，可能碰不到它（不確定，驗收清單第 7 項）
- Shorts 自己的標題文字、右側按鈕有沒有被拍進縮圖（它們不在播放器元素底下，隱藏控制列可能動不到；不確定，驗收清單第 8 項）
- YouTube 全螢幕與劇院模式、Disney+ 全螢幕
- YouTube 廣告中按快捷鍵真的沒反應（帳號是 Premium，測不到）；Disney+ 有廣告方案的廣告完全沒偵測
- YouTube 直播（`/live/`）：網址認得，秒數與「從那一秒開始看」的連結沒實測
- Disney+ 新分頁跳秒的耗時：實測約 5.5 秒成功，慢網路下要等多久沒測（最多重試 30 秒）
- Netflix 回歸：刻意沒在真 Netflix 上測，要靠驗收清單第 13、19 項

## v1.1 刻意不做（spec §4）

- YouTube 進度條預覽圖（storyboard）、Disney+ 進度條預覽圖當備案：YouTube 已有原畫面備案，Disney+ 的預覽圖只有滑過進度條時才會產生
- 嵌在其他網站的 YouTube、`m.youtube.com`、YouTube Music
- Disney+ 有廣告方案的廣告偵測
- YouTube 頻道名稱欄位
- Disney+ 連結帶秒數：沒找到這種參數，只能靠開分頁後重試跳秒
- 舊版（只認 Netflix）的擴充功能讀新版備份，會略過 YouTube、Disney+ 的筆記；可接受

## 延後處理的小問題（審查時記下，不影響主流程）

- 筆記本自動存檔沒有略過注音選字中的狀態，會多存幾次半成品（最後內容正確）
- 筆記本在視窗取得焦點時重繪，若剛好點在勾選框上，那一下可能被吃掉
- 筆記本一次讀進所有原尺寸截圖做縮圖，筆記上千則會吃記憶體
- BIF 下載卡住時會一直被快取；「最新的 .bif」可能是別部片（只影響截圖被擋時的備案）
- 頁面橋接沒檢查訊息來源；videoId 沒限定只能是數字（網址仍固定在 netflix.com）
- 圖卡沒有避頭尾（行首可能出現「，」「。」）；截圖解不開時圖卡會靜默少了圖
- 網頁檔標題把同一部影集的不同集算成「N 部作品」
- 備份檔的日期檢查太寬鬆、解壓沒有大小上限（還原的是自己的檔案，風險低）
- 驗收清單第 29 項用 2099 年的 `updatedAt` 造測試資料，測完應該直接刪掉那則筆記
- 幾處測試缺口：黑畫面判斷區塊的邊界、BIF 異常 index、圖卡下載／複製的成功路徑

## 之後的版本

- v2：網址分享（要後端，另寫設計）
- 側邊欄看筆記
