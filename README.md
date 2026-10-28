# scenenote

在 Netflix 播放頁按快捷鍵，一鍵記下畫面、秒數、台詞與心得的 Chrome 擴充功能。

擴充功能 ID：`bldeoidbgkcdnmiholglmknnimdhnhff`

## 安裝

```sh
pnpm install && pnpm build
```

1. 開 `chrome://extensions`，右上角打開「開發人員模式」。
2. 按「載入未封裝項目」，選 `/Users/bobochen/Desktop/github/bobo52310/scenenote/.output/chrome-mv3`。
3. 載入或重新載入擴充功能之後，已經開著的 Netflix 分頁要重新整理一次（內容腳本不會自動注入舊分頁）。沒重新整理就按快捷鍵或工具列圖示，頁面上不會有任何反應，但那個分頁的工具列圖示會出現 `!` 徽章，滑鼠停上去會顯示「請重新整理這個 Netflix 分頁後再按一次」；重新整理分頁後徽章會消失（最晚在下一次按鍵成功時清掉）。

manifest 固定了 `key`，所以不管資料夾放哪裡，ID 都是上面那個。沒有固定 `key` 的話，開發人員模式載入的 ID 會跟著資料夾路徑變，舊筆記就讀不到。

## 使用方式

快捷鍵是 `⌥⇧N`，可以到 `chrome://extensions/shortcuts` 改。也可以點工具列圖示（先在拼圖選單裡釘選）。

- 在 Netflix 播放頁（網址是 `www.netflix.com/watch/數字`）按：記錄這一刻。先截圖、再暫停影片，跳出小視窗。
- 在其他任何頁面按：開啟筆記本。

小視窗的按鍵：

| 按鍵 | 作用 |
|---|---|
| `Enter` | 存檔，影片繼續播放 |
| `Shift+Enter` | 心得換行 |
| `Esc` | 取消，影片繼續播放，不留筆記 |

- 台詞欄可以改；在台詞欄按 `Enter` 會跳到心得欄。
- 心得可以留空，事後再補。
- 打字時 Netflix 的快捷鍵（空白鍵、F 等）不會被觸發；中文輸入法選字的 `Enter` 不算存檔。
- 這一刻有哪一項沒抓到（圖、台詞、片名），小視窗會直接列出來。

筆記本頁面（也是擴充功能的選項頁）：

- 筆記依片名分組，影集會標季、集。
- 點時間按鈕：跳回那一刻。同一部片已經開著就切過去並暫停在那一秒；沒開就開新分頁，從那一秒播放。
- 心得可以直接改，停止打字約半秒後自動存檔，離開輸入框、切走分頁或關掉頁面時也會存。「刪除」要按兩次才會刪。
- 畫面是用進度條小圖存下來的筆記（完整截圖被擋時），縮圖旁會標「低解析度」。
- 勾選筆記後可以匯出：
  - 複製圖卡／下載圖卡：LINE 用的 PNG（寬 1080 px）。複製一次只能選一則；下載可以多則，會一張張下載。
  - 匯出網頁檔：單一 HTML，圖片內嵌，離線與手機都能開。
  - 匯出 Markdown：`notes.md` 加 `images/` 的 zip，當 blog 素材。
- 每個分組有「全選」，等於匯出整部片。
- 「全部備份」下載 zip；「從備份還原」讀同格式的 zip，`id` 相同的筆記以 `updatedAt` 較新的為準。

## 備份提醒

筆記存在擴充功能自己的 IndexedDB。**移除擴充功能會連筆記和圖片一起刪掉**。請定期按「全部備份」；筆記本頁面會顯示「上次備份」，超過 14 天會用醒目顏色提醒。

## 已知限制

- 只在 macOS 的 Chrome 上實測過；其他系統與瀏覽器沒測。
- v1 只支援 Netflix。
- 這是依賴 Netflix 頁面內部結構的做法，Netflix 改版就可能壞。設計上哪一項壞掉就只少那一項，記錄流程本身不會中斷（細節見 spec §8）：
  - 播放器內部介面讀不到：秒數改讀 `<video>`，跳回改成開那部片。
  - 片名讀不到：用分頁標題，再不行用片子編號。
  - 台詞讀不到：留空，自己打。
  - 完整截圖變黑或失敗：改用進度條小圖，標記「低解析度」。
  - 進度條小圖也沒有：筆記照存，沒有圖。
- 圖卡的換行沒有避頭尾規則，逗號、句號偶爾會出現在行首。
- 出問題時，console 裡有 `[scenenote]` 前綴的訊息可以查。

## 開發

```sh
pnpm test      # Vitest
pnpm compile   # tsc --noEmit
pnpm build     # 輸出到 .output/chrome-mv3
pnpm dev       # WXT 開發模式
```

- 設計文件：[`docs/superpowers/specs/2026-10-28-scenenote-design.md`](docs/superpowers/specs/2026-10-28-scenenote-design.md)
- 實作計畫：[`docs/superpowers/plans/2026-10-28-scenenote-v1.md`](docs/superpowers/plans/2026-10-28-scenenote-v1.md)
- 實機驗收清單：[`docs/acceptance-2026-10-28.md`](docs/acceptance-2026-10-28.md)
