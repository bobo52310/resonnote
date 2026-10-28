# scenenote 設計文件（v1：Netflix）

- 日期：2026-10-28
- 狀態：設計已逐段確認，待使用者審閱本文件
- 程式碼、commit message 用英文；本文件與介面文字用繁體中文

## 1. 目的

看影片時有啟發，按一個鍵就記下「那一刻的畫面＋秒數＋台詞＋我的心得」，之後拿來：

1. 寫 blog／社群貼文的素材
2. 點筆記跳回那一刻重看
3. 分享給家人朋友

**成功的樣子**：按快捷鍵 → 打字 → Enter，三秒內記完，影片繼續播；事後在筆記本頁面能跳回、能匯出成上面三種用途要的格式。

## 2. 範圍

| 版本 | 內容 |
|---|---|
| **v1（本文件）** | Netflix；截圖＋秒數＋片名＋台詞＋心得；跳回那一秒；匯出 LINE 圖卡、網頁檔、Markdown；附 Netflix 連結；備份與還原 |
| v2 | 網址分享（要後端，屆時另寫設計） |
| 之後 | Disney+、YouTube（各加一個平台轉接層）；側邊欄看筆記 |

使用對象：先給自己用（開發人員模式載入），但保留上架 Chrome 線上應用程式商店的路——權限最小、不連任何外部服務。

**v1 刻意不做**：標籤分類、錄音、一次截多張、心得分「啟發／筆記」兩欄、跨電腦同步、網址分享。

## 3. 已實測的技術事實（2026-10-28，macOS＋Chrome，片子：《造山者－世紀的賭注》，編號 83053998）

| 項目 | 結果 |
|---|---|
| macOS 系統截圖（⌘⇧4） | 影片區域全黑，只剩字幕（字幕是網頁 DOM） |
| 擴充功能 `chrome.tabs.captureVisibleTab` | **截得到完整影片畫面**，2880×1496（Retina 實際像素），字幕與播放器按鈕也在圖裡。用拋棄式測試擴充功能（`activeTab` 權限、點工具列圖示觸發）驗證 |
| 進度條預覽小圖（BIF 檔） | 播放時頁面會載入 `https://occ-*.nflxso.net/tp/…/*.bif`，從頁面內 `fetch` 回 200、無加密。整部片一個檔：106 分鐘片共 638 張、5.85 MB；每 10 秒一張、320×180 JPEG |
| BIF 格式 | 前 8 bytes 為 `89 42 49 46 0d 0a 1a 0a`；offset 12 為 uint32 LE 圖片張數；offset 16 為 uint32 LE 間隔毫秒（10000）；offset 64 起為索引表，每筆 8 bytes＝(第幾張, 圖片起始 offset)，第 i 張圖＝`[offset_i, offset_{i+1})` |
| 頁面上的 `<video>` | 讀得到 `currentTime`、`duration`、`videoWidth/Height`（1920×1080）；`video.pause()` 可暫停 |
| Netflix 播放器內部介面 | `netflix.appContext.state.playerApp.getAPI().videoPlayer` 存在；`getAllPlayerSessionIds()` → `getVideoPlayerBySessionId(id)` 取得 player，有 `seek(ms)`、`getCurrentTime()`（毫秒）、`getMovieId()`、`pause()`、`isPaused()`、`getTrickPlayFrame(ms)`。實測 `seek` 往回跳 10 秒成功、無錯誤畫面；`pause()` 後 `isPaused()` 與 `<video>.paused` 皆為 true。此介面在頁面自己的 JS 環境（main world），擴充功能要用 main world script 才碰得到 |
| `player.getTrickPlayFrame(ms)` | 回傳 `{ image: Uint8Array, time, width, height, … }`——播放器自己就能給那一秒的進度條小圖，不必自己解析 BIF（BIF 解析留作退路） |
| 片名 metadata | `netflix.appContext.state.playerApp.getState().videoPlayer.videoMetadata[<movieId>]._metadata.video` 有 `title`、`type`（電影為 `'movie'`）、`id`。影集的季、集欄位尚未實測（見 §10） |
| 網址帶秒數 | 開 `https://www.netflix.com/watch/83053998?t=600` 會從第 600 秒開始播（實測 4 秒後在 603.7 秒） |
| 字幕 DOM | Language Reactor 開著時，Netflix 原生的 `.player-timedtext` 是空的且被隱藏；畫面上的台詞在 `#lln-main-subs .lln-subs-text`，拼音在其中的 `.translit` 元素，去掉拼音後文字形如 `... 而 ... 二 樓 ... 則 ...`（字之間有空白與 `...`） |
| 播放器控制列 | 滑鼠不動時控制列元素根本不在 DOM 裡（只剩 `data-uia` 為 `watch-video`、`player`、`video-canvas` 的容器） |

## 4. 記錄流程

**觸發**：快捷鍵 ⌥⇧N（`chrome.commands`，使用者可在 `chrome://extensions/shortcuts` 改），或點工具列圖示。兩者都會給 `activeTab`，`captureVisibleTab` 靠這個權限。**在 Netflix 播放頁（`/watch/<數字>`）觸發＝記錄；在其他任何頁面觸發＝開啟筆記本頁面**（筆記本頁面也設為擴充功能的選項頁）。

**按下去後依序：**

1. **先截圖、後暫停**——Netflix 暫停幾秒後會蓋上片名介紹層，所以截圖要在暫停之前。
   - 背景程式先通知內容腳本「開始」：內容腳本記下當下的播放資訊、台詞與影片位置；若小視窗已開著就回覆「忙碌中」，這次觸發直接忽略。
   - 接著背景程式呼叫 `captureVisibleTab`（JPEG，quality 90），再把截圖交給內容腳本。
   - 不另外隱藏控制列：滑鼠不動時控制列不在畫面上（§3）；若剛好露出來就照原樣截。
2. **裁切**：依 `<video>` 的 `getBoundingClientRect()` × `devicePixelRatio`，再依 `videoWidth/videoHeight` 算出 object-fit: contain 的實際畫面範圍，裁掉左右（或上下）黑邊與側邊按鈕。字幕照原樣保留（含 Language Reactor 的拼音）。
3. **黑畫面判斷**：裁切後取畫面中上方區塊（寬 20–80%、高 15–60%），亮度 < 16 的像素比例 > 95% 視為被擋 → 改用進度條小圖，筆記標記為「低解析度」。進度條小圖先用 `player.getTrickPlayFrame(ms)`（回傳的位元組要以 JPEG 檔頭 `FF D8` 開頭才算數），取不到再自己抓 BIF 解析（取 `floor(毫秒 / 間隔)` 那一張）。截圖 API 失敗也走同一條退路。
4. **暫停並收集資料**：暫停影片；記下平台、片子編號、片名（影集加季、集）、秒數（毫秒）、當下字幕文字（沒開字幕則空字串）。字幕來源依序：Netflix 原生 `.player-timedtext` 的文字 → Language Reactor 的 `#lln-main-subs .lln-subs-text`（去掉 `.translit` 拼音、去掉 `...`、中日韓文字之間的空白拿掉、其他字之間保留一個空白）→ 空字串。
5. **小視窗**（Shadow DOM 隔離樣式；掛在 `document.fullscreenElement` 或播放器容器上，全螢幕也看得到）：
   - 左：截圖縮圖；右：片名、時間（如 16:43）、台詞（可編輯）。
   - 下：心得輸入框（單一欄位）。**Enter 存檔並繼續播放**；Shift+Enter 換行；Esc 取消並繼續播放。心得空白也能存（先標記、事後補）。
   - 輸入時攔下按鍵事件，不讓 Netflix 的快捷鍵（空白鍵、F 等）觸發。
   - 中文輸入法選字時按的 Enter（`isComposing` 為 true）只用來選字，不算存檔。
   - 存檔失敗時小視窗不關、已打的字保留，顯示錯誤訊息，影片維持暫停。
   - 這次若有任何一項取不到（見 §7），在小視窗上直接列出缺了什麼。

## 5. 資料與儲存

**一則筆記（Note）：**

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | string | UUID |
| `platform` | `'netflix'` | 之後加 `'disney' \| 'youtube'` |
| `videoId` | string | Netflix 片子編號（影集為該集的編號） |
| `title` | string | 片名（影集為劇名） |
| `season` / `episode` / `episodeTitle` | number / number / string，可省略 | 電影沒有 |
| `timeMs` | number | 毫秒 |
| `subtitle` | string | 可為空 |
| `body` | string | 心得，可為空 |
| `image` | `{ source: 'tab' \| 'trickplay' \| 'none', width, height }` | 圖檔本身另存 |
| `createdAt` / `updatedAt` | ISO 字串 | |

**儲存位置**：擴充功能自己的 IndexedDB，兩個 store——`notes`（上表）與 `images`（以 note id 為鍵，存 JPEG 的 `ArrayBuffer`）。申請 `unlimitedStorage`。不上傳、不同步。內容腳本跑在 netflix.com 的來源底下，它的 IndexedDB 是 Netflix 網域的，所以**內容腳本不直接寫資料庫**：把筆記與 JPEG（data URL 字串）傳給背景程式，由背景程式寫入；筆記本頁面與背景程式同屬擴充功能來源，直接讀寫同一個資料庫。

**兩個陷阱與對策：**

1. **移除擴充功能會連筆記一起刪**。v1 就做：
   - 「全部備份」：下載一個 zip，內含 `notes.json`＋`images/<id>.jpg`。
   - 「從備份還原」：讀同格式 zip；`id` 相同的筆記以 `updatedAt` 較新者為準。
   - 筆記本頁面顯示「上次備份：X 天前」，超過 14 天用醒目顏色提醒。
2. **開發人員模式載入的擴充功能，ID 由資料夾路徑決定，搬資料夾就換 ID、舊資料讀不到**。對策：在 manifest 固定 `key`，讓 ID 永遠不變。

## 6. 跳回與匯出

### 6.1 跳回那一秒（筆記本頁面點一則筆記）

- 已有開著同一部片（同 `videoId`）的 Netflix 分頁：切過去 → `seek(timeMs)` → 暫停。
- 沒有：開新分頁到 `https://www.netflix.com/watch/<videoId>?t=<秒>`（§3 已實測會從該秒開始播）。

### 6.2 Netflix 連結（附在匯出內容裡）

`https://www.netflix.com/watch/<videoId>?t=<秒，無條件捨去>`，連結文字為「在 Netflix 從 16:43 開始看」。

### 6.3 三種匯出

範圍：單則、勾選多則、或整部片。

1. **LINE 圖卡（PNG）**：寬 1080 px，高度依內容。由上而下：截圖、片名與時間、台詞（引號框）、心得。用 canvas 在筆記本頁面畫，字型用系統字（macOS 為蘋方）。兩種用法：「複製圖片」（`navigator.clipboard.write`，貼到 LINE 電腦版）或下載。多則就產生多張。
2. **網頁檔（單一 HTML）**：圖片縮到寬 1280 px、以 base64 內嵌，離線可開、手機版面。每則含截圖、時間、台詞、心得、Netflix 連結。預估 20 則約 3–5 MB。
3. **Markdown（blog 素材，zip）**：`notes.md`＋`images/`。每則一段：時間為小標，下面依序是圖、引用台詞、心得、Netflix 連結。不加 blog frontmatter（這是素材，不是文章）。

## 7. 架構

```
src/
  platforms/
    types.ts           # PlatformAdapter 介面
    netflix/           # v1 唯一的平台轉接層
      adapter.ts       # 內容腳本端（isolated world）
      page-bridge.ts   # main world：碰 netflix.appContext 的部分
      bif.ts           # BIF 解析（純函式）
  core/
    capture.ts         # 截圖、裁切計算、黑畫面判斷（裁切與判斷是純函式）
    overlay/           # 播放器上的小視窗（Shadow DOM）
    db.ts              # IndexedDB（notes / images）
    backup.ts          # zip 備份與還原
  notebook/            # 筆記本頁面（擴充功能自己的頁面）
  export/
    card.ts            # LINE 圖卡
    html.ts            # 網頁檔
    markdown.ts        # Markdown zip
  background.ts        # 快捷鍵、captureVisibleTab、找分頁／開分頁
```

**PlatformAdapter 介面**（每個方法失敗時回傳 `null`，不丟例外）：

- `getPlayback()` → `{ videoId, title, season?, episode?, episodeTitle?, timeMs }`
- `getSubtitleText()` → string
- `pause()` / `play()` / `seek(timeMs)`
- `getVideoRect()` → 畫面上實際影片範圍（CSS px）
- `getTrickplayFrame(timeMs)` → JPEG Blob
- `watchUrl(videoId, timeMs)` → string

main world 與內容腳本之間用 `window.postMessage`（帶固定的訊息前綴）溝通。

**技術選擇**：TypeScript、WXT、Vitest；zip 用 fflate；IndexedDB 用 idb；套件一律裝當下最新穩定版。

**權限**：`activeTab`、`unlimitedStorage`、`storage`（設定值）；host 權限只要 `https://www.netflix.com/*`。進度條小圖（含 BIF 退路）由 main world script 在 Netflix 頁面內取得，不需要 `nflxso.net` 的 host 權限。

## 8. Netflix 改版時的退路

原則：**哪一項壞掉就只少那一項，記錄流程本身不中斷**；缺什麼在小視窗上直接顯示。

| 壞掉的部分 | 退路 |
|---|---|
| 播放器內部介面（`netflix.appContext…`） | 秒數改讀 `<video>.currentTime`；暫停改用 `video.pause()`（已實測可行）；跳回改成開那部片，並提示「從 16:43 開始看」 |
| 片名讀不到 | 用分頁標題，再不行就用片子編號 |
| 字幕讀不到 | 台詞留空，使用者自己打 |
| 完整截圖變黑或失敗 | 用進度條小圖，標記「低解析度」 |
| 進度條小圖也抓不到 | 筆記照存，`image.source = 'none'` |

錯誤一律以 `[scenenote]` 前綴寫到 console，方便除錯。

## 9. 測試與驗收

**自動測試（Vitest）：**

- BIF 解析：用測試裡自己組出來的小型 BIF（3 張圖）驗證張數、間隔、取第 i 張的位元組範圍、超出範圍時夾到最後一張。
- 裁切計算：16:9 影片放在不同比例的容器裡，算出的範圍正確。
- 黑畫面判斷：全黑圖判為被擋、一般畫面判為正常。
- 三種匯出的內容：Markdown 文字、HTML 結構（含 base64 圖與連結）、圖卡尺寸。
- 備份→還原：資料一致；`id` 相同時取 `updatedAt` 較新者。
- 字幕擷取：用存下來的 Netflix 播放頁 DOM 片段當 fixture。

**實機驗收清單（真 Netflix）：**

1. 視窗模式與全螢幕各記一則，截圖為完整畫面且已裁掉黑邊
2. 開字幕與不開字幕各記一則，台詞欄正確或為空
3. 電影與影集各記一則，影集有季、集
4. 按 Esc 取消後影片繼續播、沒有多一則筆記
5. 在小視窗打字時，空白鍵、F 不會觸發 Netflix
6. 跳回：同分頁、新分頁兩種情況都停在正確秒數
7. LINE 圖卡：複製後貼到 LINE 電腦版正常；下載的 PNG 正常
8. 網頁檔：iPhone 版 LINE 收到後能直接點開看（不行 → 網頁檔改出 PDF，另議）
9. Markdown zip 解開後圖片連結正確
10. 備份→移除擴充功能→重裝→還原，筆記與圖片都回來
11. 搬動擴充功能資料夾後重新載入，筆記仍在（固定 `key` 生效）
12. 開著 Language Reactor 與關掉 Language Reactor 各記一則，台詞都正確且沒有拼音
13. 中文輸入法打心得時，選字的 Enter 不會提早存檔

需要真人操作的（載入擴充功能、按快捷鍵、LINE 手機版）列清單給使用者；其餘由 Claude in Chrome 檢查。

## 10. 尚未實測、留到實機驗收確認的事

2026-10-28 已確認並寫回 §3／§4／§6 的：網址 `?t=`、`pause()`、`getTrickPlayFrame`、電影 metadata、Language Reactor 字幕 DOM、控制列不需隱藏。

還沒確認的只剩一項：**影集的季、集**在 metadata 裡的結構。實作先假設 `type === 'show'` 時有 `seasons[].seq`、`seasons[].episodes[].{id, seq, title}`，以目前播放的 `movieId` 對到集；對不到就只記劇名。由驗收清單第 3 項確認。
