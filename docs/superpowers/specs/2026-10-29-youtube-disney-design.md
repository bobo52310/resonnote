# ResonNote 設計文件（v1.1：加上 YouTube 與 Disney+）

- 日期：2026-10-29
- 狀態：使用者交代「更全面支援 YouTube／Disney+，詳細研究和開發」後離線，本文件的決定由 Claude 依實測自行定案，待使用者審閱
- 延續 [`2026-10-28-scenenote-design.md`](2026-10-28-scenenote-design.md)（以下稱 v1 spec）；沒提到的部分照 v1 spec
- 程式碼、commit message 用英文；本文件與介面文字用繁體中文

## 1. 目標

在 YouTube 與 Disney+ 的播放頁，按 ⌥⇧N（或工具列圖示、頁面上的「記下這一刻」）一樣能記下畫面、秒數、片名、台詞與心得；筆記本裡能跳回那一刻、匯出時附上對應平台的連結。Netflix 的行為不變。

## 2. 已實測的技術事實（2026-10-29，macOS＋Chrome，使用者自己的瀏覽器與帳號）

### 2.1 YouTube（片子：TED《Inside the Mind of a Master Procrastinator》，`arj7oStGLkU`）

| 項目 | 結果 |
|---|---|
| 播放器內部介面 | `document.getElementById('movie_player')` 在頁面自己的 JS 環境（main world）有 `getCurrentTime()`（秒，小數）、`seekTo(秒, true)`、`pauseVideo()`、`playVideo()`、`getPlayerState()`（1＝播放中）、`getVideoData()` → `{ video_id, title, author, isLive, … }`、`getPlayerResponse()`。內容腳本的 isolated world 看不到這些方法 |
| `<video>` | 播放頁只有一個有畫面的 `#movie_player video.html5-main-video`（1920×1080）。**Shorts 頁有兩個**：`#shorts-player video`（有畫面）與 `#movie_player video`（0×0、暫停中），不能直接 `querySelector('video')` |
| Shorts 的播放器 | `document.getElementById('shorts-player')` 有同一組方法，`getVideoData().video_id` 對得上網址 `/shorts/<id>` |
| 網址帶秒數 | `https://www.youtube.com/watch?v=<id>&t=60s` 從第 60 秒開始播（實測） |
| 字幕 DOM | `#ytp-caption-window-container .caption-window` → `.captions-text` → 每一行 `.caption-visual-line` → `.ytp-caption-segment`。**剛開字幕或切換語言時，會短暫多一個 `.ytp-caption-window-top` 視窗，內容是語言名稱（如「英文」）加一個 `<svg>` 設定圖示**；約 4 秒後消失。讀台詞時要略過含 `<svg>` 的視窗 |
| 其他字幕擴充 | 使用者裝了一個會在播放器裡放 `.twsrt-subtitles-container` 的擴充；實測期間它是空的，沒納入讀取來源 |
| 控制列 | 全在 `#movie_player` 的子元素裡（`.ytp-chrome-top`、`.ytp-chrome-bottom`、`.ytp-gradient-*`、`.ytp-ce-element` 片尾卡片…）。用 v1 的作法「播放器裡除了影片與字幕，其他子元素一律 `opacity: 0`」實測：暫停中（控制列本來會一直顯示）截圖只剩畫面與字幕 |
| 截圖 | 沒有 DRM。`canvas.drawImage(video)` 拿得到 1920×1080 原始畫面、`toDataURL` 不會被擋（實測，main world）。可以當「頁面按鈕還不能截圖」時的備案，畫質比進度條小圖好很多（但不含字幕） |
| 進度條預覽圖 | `getPlayerResponse().storyboards.playerStoryboardSpecRenderer.spec` 有 storyboard 規格（`|` 分隔的多個解析度，最大一級 320 px 寬）。因為上一列的原畫面備案已經夠用，**這版不做** |
| 鍵盤 | 在 shadow DOM 裡的 `<textarea>` 打 `k j l f m c`、空白鍵、方向鍵，YouTube 都不會反應（影片照播、沒跳秒、沒靜音、沒全螢幕）——v1 的小視窗按鍵隔離在 YouTube 也成立 |

### 2.2 Disney+（影集：《尚公主》第 1 季第 2 集；電影：《內幕》）

| 項目 | 結果 |
|---|---|
| 播放頁網址 | `https://www.disneyplus.com/zh-hant/play/<UUID>`。開 `https://www.disneyplus.com/play/<UUID>`（沒有語系）會自動轉到 `/zh-hant/play/<UUID>` 並開始播放。電影的 play id 等於它的 entity id；影集每一集有自己的 id。是單頁應用 |
| `<video>` | **有兩個**：`video.btm-media-client-element`（0×0，沒用）與真正的 `video#hivePlayer1.hive-video`（滿版、`object-fit: contain`） |
| **`<video>.currentTime` 不是劇集時間** | 同一時刻 `<video>.currentTime` 是 70 秒、播放器顯示 0:49；跳秒之後 `currentTime` 變成 22（重新起算）。**不能用 `<video>` 讀秒數或跳秒** |
| 播放器內部介面 | main world 的 `document.querySelector('disney-web-player').mediaPlayer`：`timeline.info.playheadPositionMs`（劇集毫秒，正確）、`timeline.info.programDurationMs`、`seek(毫秒)`（實測跳到 300000 → 301820）、`pause()`、`play()`、`playbackStatus.currentState`（`NOTREADY` / `PAUSED` / `PLAYING`…） |
| 片名、季、集 | `mediaPlayer.mediaPlaybackCriteria.metadata.title.text`＝「尚公主」；`.subtitle.text`＝「第 1 季第 2 集：第2集」（**跟著介面語言的文字，沒有數字欄位**）；電影的 `subtitle.text` 是空字串。分頁標題是「尚公主 \| Disney+」 |
| 字幕 DOM | `disney-web-player-ui > timed-text-override-region` 的 **shadow root**（open）裡：`.hive-subtitle-renderer-wrapper … span.hive-subtitle-renderer-cue > span.hive-subtitle-renderer-line` |
| 控制列 | `disney-web-player-ui` 底下的 `title-overlay`、`main-app-controls-overlay`、`ratings-overlay`… 等自訂元素，各自有 shadow root；滑鼠不動幾秒後整組被拿掉（進度條也不在 DOM 裡） |
| 截圖 | 分頁截圖看得到畫面（含字幕）。`<video>` 有 `mediaKeys`（DRM），`canvas.drawImage(video)` 整張全黑——**原畫面備案不適用** |
| 進度條預覽圖 | 滑過進度條時的預覽是 `progress-bar-preview` 裡 `.preview-image` 的 JPEG data URL；`mediaPlayer.timeline.scrubPreview.thumbnailSrc` 會跟著變，但直接呼叫 `mediaPlayer.scrub(ms)` 不會產生預覽圖。**這版不做** |
| 網址帶秒數 | 沒找到；開 `/play/<UUID>` 會從上次看到的地方接著播 |
| 開新分頁後跳秒 | 播放器剛出現時的第一個 `PAUSED` 狀態跳秒會被忽略。作法「`seek` → 等 1.2 秒 → 讀 `playheadPositionMs` 對不對，不對就再來」：實測第 2 次（開頁後約 5.5 秒）成功停在 10:00 |

## 3. 決定

### 3.1 資料

- `Platform` 變成 `'netflix' | 'youtube' | 'disney'`；舊筆記都是 `'netflix'`，不用搬資料。
- `videoId`：Netflix 數字、YouTube 11 碼、Disney+ UUID。**同一部片的判斷一律用「平台＋videoId」**（筆記本分組、小視窗「之前的筆記」、跳回時找分頁）。
- `image.source` 多一種 `'frame'`：從 `<video>` 直接取的原始畫面（目前只有 YouTube）。畫質完整，不標「低解析度」；但不含字幕。
- 備份：`notes.json` 的 `platform` 接受三種值，`image.source` 接受 `'frame'`；備份格式版本仍是 1。**舊版擴充功能（只認 Netflix）讀到含任何 YouTube／Disney+ 筆記、或任何 `image.source: 'frame'` 的備份，會整份拒絕**，顯示「這不是 ResonNote 的備份檔，或檔案已損壞」，連裡面的 Netflix 筆記也還原不了（不是只略過新筆記）；只含 Netflix 筆記、沒有 `'frame'` 的新版備份，舊版照常讀。要在舊版還原，得先用新版把那些筆記排除。這版不升格式版本，先接受這個限制。
- YouTube 頻道名稱這版不存（Note 不加欄位）；YouTube 片名常已含頻道。

### 3.2 平台登錄表（`src/platforms/registry.ts`，純函式，背景程式、筆記本、匯出共用）

每個平台一筆：名稱（`Netflix`／`YouTube`／`Disney+`）、`parseWatchVideoId(url)`、`watchUrl(videoId, timeMs)`、`linkKeepsTime`（連結本身能不能從那一秒開始）、`tabPatterns`（`tabs.query` 用）。加上 `detectWatchPage(url) → { platform, videoId } | null`。

| 平台 | 播放頁 | 連結 | 連結文字 |
|---|---|---|---|
| Netflix | 同 v1 | 同 v1 | 在 Netflix 從 16:43 開始看 |
| YouTube | `www.youtube.com/watch?v=<11碼>`、`/shorts/<11碼>`、`/live/<11碼>` | `https://www.youtube.com/watch?v=<id>&t=<秒>s` | 在 YouTube 從 16:43 開始看 |
| Disney+ | `www.disneyplus.com/[語系/]play/<UUID>`（也接受舊的 `/video/<UUID>`） | `https://www.disneyplus.com/play/<UUID>` | 在 Disney+ 打開（這一刻在 16:43） |

Disney+ 的連結文字刻意寫出「這一刻在 16:43」：分享出去的網頁檔、Markdown 裡，別人點連結不會跳到那一秒。

### 3.3 記錄流程（沿用 v1，只換平台轉接層）

- 三個平台各一組內容腳本：isolated world 的轉接層＋小視窗，main world 的頁面橋接（碰播放器內部介面）。共用的部分抽成一個 `runContentScript({ platform, adapter, watchVideoId, … })`（`watchVideoId` 回目前播放頁的 videoId，不是播放頁回 `null`）。
- 頁面橋接的訊息格式（`window.postMessage`、固定前綴）三個平台共用，每個平台自己回答。橋接只回應**同一個視窗**送來的請求（`event.source === window`），內容腳本等回答時也只收同一個視窗的；頁面裡別的來源的 iframe 送的訊息不會被理會。
- 截圖前，頁面按鈕由 `runContentScript` 一併隱藏（`hideForScreenshot`：`visibility: hidden !important`，立刻生效、不走淡出），不靠各平台的「隱藏控制列」碰到它——按鈕掛在 `body`（全螢幕時掛在全螢幕元素），不在任何平台的播放器元素底下。三個平台都一樣，與按鈕貼在哪裡無關。
- 截圖選圖順序：分頁截圖裁切（沒被擋）→ **轉接層的原畫面（`grabFrame`，YouTube）** → 進度條小圖（Netflix）→ 沒有圖。「先用一次快捷鍵」的提示只在最後拿到的是進度條小圖或沒有圖時顯示。
- **YouTube 轉接層**
  - 秒數、片名、videoId：橋接讀 `getVideoData()`、`getCurrentTime()`；讀不到就退回網址＋`<video>.currentTime`＋分頁標題（去掉開頭的「(3) 」通知數與結尾的「 - YouTube」）。
  - 廣告播放中（播放器有 `ad-showing` class）：`getPlayback` 回 `null`，不記（廣告的秒數不是影片的秒數）。
  - 播放器：網址是 `/shorts/` 用 `#shorts-player`，其他用 `#movie_player`；`<video>` 取該播放器裡的 `video.html5-main-video`。
  - 暫停、播放、跳秒：橋接呼叫播放器方法；不行就直接操作 `<video>`（YouTube 沒有 DRM，`currentTime` 可以設）。
  - 台詞：略過含 `<svg>` 的字幕視窗，其餘視窗的每一行以空白相接；沒有就讀 Language Reactor（`#lln-main-subs`，同 v1 的清理規則）。
  - 截圖前隱藏：只動播放器元素底下的子元素（不是整個 `body`，避免整頁閃一下），保留 `video`、字幕容器、Language Reactor 字幕。
  - 原畫面：橋接把 `<video>` 畫到 canvas，輸出 JPEG（quality 0.9）。
- **Disney+ 轉接層**
  - 秒數、片名、季集、暫停、播放、跳秒：全靠橋接的 `mediaPlayer`。
  - 季、集：解析 `subtitle.text`：`第 1 季第 2 集：<集名>`、`S1:E2 <集名>`、`Season 1 Episode 2 <集名>`；集名若只是「第2集」「Episode 2」這種跟集數重複的字就不存（同 v1 spec §10 的規則）。解析不了就整段當集名。
  - 橋接讀不到時：**不退回 `<video>.currentTime`**（實測不是劇集時間），改讀進度條的 `aria-valuenow`（秒，控制列露出時才在）；兩個都沒有就回 `null`。
  - 跳秒：橋接 `seek(ms)` 後等最多 1.5 秒確認 `playheadPositionMs` 與目標差不到 3 秒才算成功。
  - 台詞：`timed-text-override-region` 的 shadow root 裡的 `.hive-subtitle-renderer-line`，以空白相接；也接受舊的 `.dss-subtitle-renderer-line`。
  - 截圖前隱藏：`document.fullscreenElement ?? body` 底下，保留 `video` 與 `timed-text-override-region`。
  - 原畫面、進度條小圖：都沒有（回 `null`）。

### 3.4 跳回那一秒

- 背景程式用登錄表判斷平台，找「同平台、同 videoId」的分頁；有就切過去、跳秒、暫停（同 v1）。
- 沒有就開新分頁到連結。**連結不能帶秒數的平台（Disney+）**：開分頁後每秒送一次 `seek` 給那個分頁，直到內容腳本回答成功，最多 30 秒（從開分頁或導向連結起算的時間，不是次數）；同一個分頁跳秒失敗改導向連結時也一樣。
- `seek` 訊息帶筆記的 `videoId`；頁面現在播的不是那部片（等待期間使用者換了別部、或 Disney+ 自己接著播下一集）就回 `false`，不動播放器也不暫停。沒帶 `videoId` 的 `seek` 照舊直接跳。
- 跳回訊息多帶 `platform`；沒帶的當 Netflix（相容）。

### 3.5 頁面上的「記下這一刻」按鈕

- Netflix、Disney+：照 v1，固定在視窗右下。
- YouTube：一般模式下播放器不是滿版，按鈕改成貼在**播放器**右下角（離右邊 24 px、離底部 80 px，避開控制列），而且只在滑鼠在播放器上移動時出現；捲動頁面時收起來。

### 3.6 介面文字

- 小視窗「缺了什麼」：`播放器介面讀不到，秒數改從影片讀`（拿掉 Netflix 字樣）。
- 工具列徽章提示：`請重新整理這個 <平台> 分頁後再按一次`。
- 筆記本：空狀態「還沒有筆記。在 Netflix、YouTube 或 Disney+ 播放時按 ⌥⇧N 記下第一則。」；每組片名旁加平台名稱的小標籤；時間按鈕提示「跳到 <平台> 的這一刻」。
- manifest 描述：「…（支援 Netflix、YouTube、Disney+）」；`host_permissions` 加 `https://www.youtube.com/*`、`https://www.disneyplus.com/*`（`tabs.query` 依網址找分頁要用）。

## 4. 這版刻意不做

- YouTube storyboard 與 Disney+ 進度條預覽圖當備案（見 §2）。
- 內嵌在其他網站的 YouTube、`m.youtube.com`、YouTube Music。
- Disney+ 有廣告方案的廣告偵測（實測帳號沒有廣告）。
- YouTube 頻道名稱欄位。

## 5. 測試

- 自動測試：三個平台的網址解析、登錄表、YouTube／Disney+ 的字幕擷取（用 §2 實測到的 DOM 結構當 fixture）、兩個轉接層（橋接 mock）、兩個頁面橋接（假播放器物件）、季集文字解析、跳回（含 Disney+ 開新分頁後重試跳秒）、觸發時的平台判斷、筆記本分組（同 videoId 不同平台分開）、匯出連結文字、備份接受新平台與 `'frame'`、頁面按鈕貼在播放器上。
- 真網站驗證：把建好的轉接層＋頁面橋接注入真的 YouTube、Disney+ 分頁，跑讀秒數、片名、台詞、跳秒、暫停、隱藏控制列、原畫面。
- 需要使用者本人做的：重新載入擴充功能後，在三個平台各記一則、跳回、匯出（見驗收清單）。

## 6. 實作後的真網站驗證（2026-10-29 晚）

作法：把建好的內容腳本（`youtube.content.ts`／`disney.content.ts` 與各自的頁面橋接，原封不動）打包，搭配一個在頁面裡模擬背景程式的替身（它呼叫真的 `handleTrigger`，但拿不到 `captureVisibleTab`，等同「頁面按鈕在這個分頁還沒用過快捷鍵」），注入使用者 Chrome 裡真的 YouTube、Disney+ 分頁執行。沒有經過 `chrome://extensions` 載入真正的擴充功能。

| 項目 | YouTube（TED 演講、Shorts） | Disney+（《尚公主》第 1 季第 2 集） |
|---|---|---|
| 讀 videoId、秒數、片名 | ✅ 站內換到另一支影片後也正確 | ✅ 劇集時間與播放器內部一致（同時 `<video>.currentTime` 是 33 秒，沒被用到） |
| 季、集 | — | ✅「第 1 季第 2 集：第2集」→ 第1季第2集，重複的集名沒存 |
| 台詞 | ✅ | ✅ |
| 暫停、跳秒、播放 | ✅ | ✅（跳到 10:00 約 0.3 秒） |
| 截圖前隱藏控制列 | ✅ 只剩畫面與字幕 | ✅ 控制列露出時隱藏，只剩畫面與字幕 |
| 頁面按鈕位置 | ✅ 一般播放頁貼在播放器右下；Shorts 貼在直式播放器右下 | ✅ 視窗右下、進度條上方 |
| 完整記錄流程（按鈕 → 小視窗 → 打字 → Enter） | ✅ 用 `<video>` 原畫面（1920×1080，`source: 'frame'`），沒出現「先按一次快捷鍵」提示；存檔後繼續播 | ✅ 沒有圖（DRM），顯示「先按一次快捷鍵」提示；存檔後繼續播 |
| 小視窗打字不觸發網站快捷鍵（`k j l f m`、空白、方向鍵） | ✅ | ✅ |
| 跳回（送 `scenenote/seek`） | ✅ 停在 1:00 並暫停 | ✅ 重新載入的分頁停在 25:00 並暫停 |

這次驗證抓到並修掉一個問題：YouTube 在頁面自己的 JS 環境強制 Trusted Types，頁面按鈕原本用 `innerHTML` 放 SVG 圖示會被擋，改成逐一建立 SVG 節點。

沒驗到、留給使用者：真正載入擴充功能後的端對端（含 `captureVisibleTab` 截圖與裁切）、YouTube 全螢幕與劇院模式、YouTube 廣告（帳號是 Premium）、Netflix 回歸（刻意不在真 Netflix 上測，避免踢掉使用者自己正在看的串流）。
