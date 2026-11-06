# Chrome 線上應用程式商店：商店資訊（Store listing）

在開發人員資訊主頁（Developer Dashboard）的「商店資訊／Store listing」分頁照下面貼。每個 `text` 區塊都可以整塊複製。

查證日期：2026-11-06。官方依據：

- 商店資訊分頁各欄位：<https://developer.chrome.com/docs/webstore/cws-dashboard-listing>
- 名稱、摘要、說明的寫法：<https://developer.chrome.com/docs/webstore/best-listing>
- manifest `name` 上限 75 字元：<https://developer.chrome.com/docs/extensions/reference/manifest/name>
- manifest `description`（摘要）上限 132 字元：<https://developer.chrome.com/docs/extensions/reference/manifest/description>
- 關鍵字濫用（keyword spam）：<https://developer.chrome.com/docs/webstore/program-policies/listing-requirements>

## 先知道：名稱和摘要來自擴充功能套件，不是在網頁上填

官方文件說商店資訊分頁是用來填「manifest 沒有的資訊」（說明、截圖、影片、連結），所以**名稱與摘要是讀 zip 裡 `manifest.json` 的 `name`、`description`**，在網頁上不能另外改。要改的話得改 `wxt.config.ts` 再重新打包上傳。

- 目前的 manifest 沒有 `_locales`、也沒有 `default_locale`，所以商店只會有**一個語言版本**：繁體中文。
- 下面的 English 版是預備稿：等之後在擴充功能加了 `_locales/en/messages.json`（屬程式變更，另開工作），商店的語言下拉選單才會出現 English，屆時再貼英文說明、上傳英文截圖。官方文件：「Each locale corresponds to one of the `_locales/LOCALE_CODE` directories included in the extension.」
- 不建議把中英文說明塞在同一欄：官方把「同一個關鍵字不自然地重複超過 5 次」列為關鍵字濫用的例子，兩種語言合併後 Netflix、YouTube、Disney+ 各自會超過 5 次。

---

## 繁體中文（zh-TW）

### 名稱（來自 manifest `name`，上限 75 字元）

```text
ResonNote 共鳴筆記
```

字數：14 字元（Unicode 碼位與 UTF-16 都是 14；UTF-8 是 22 位元組）。

### 摘要（來自 manifest `description`，上限 132 字元）

```text
看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得（支援 Netflix、YouTube、Disney+）
```

字數：**53 字元**（Unicode 碼位 53、UTF-16 53；就算用 UTF-8 位元組算也只有 115，仍低於 132）。這就是 `wxt.config.ts` 現有的 `description`，不用改。

計算方式（Python，逐字元計數）：

```sh
python3 -c "import sys; s=sys.argv[1]; print(len(s), len(s.encode('utf-16-le'))//2, len(s.encode()))" \
  "看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得（支援 Netflix、YouTube、Disney+）"
# 53 53 115
```

### 詳細說明（貼進「說明／Description」）

```text
看劇有共鳴的那一秒，按一下 ⌥⇧N（Alt+Shift+N），ResonNote 共鳴筆記就把這一刻留下來：畫面、秒數、片名、台詞，再加上你自己的心得。支援 Netflix、YouTube、Disney+ 的播放頁。

■ 怎麼用
1. 在播放頁按快捷鍵，或點工具列圖示；滑鼠一動，頁面上也會浮出「記下這一刻」按鈕。
2. 擴充功能先截圖、再暫停影片，跳出小視窗：畫面、秒數、片名、台詞自動帶入，台詞可以改。
3. 寫下心得（可以留空），按 Enter 存檔，影片繼續播放；按 Esc 取消，不留筆記。

■ 功能
・膠卷小格：小視窗上方是這支影片前面記過的筆記（最多兩格），點一格就能打開修改，或刪掉那一則。
・筆記本：依「平台＋片子」分組，影集會標季、集。點時間按鈕跳回那一秒：同一部片已經開著就切過去並暫停在那一秒，沒開就開新分頁。心得可以直接改，會自動存檔。
・匯出：LINE 用的 PNG 圖卡（寬 1080 px）、單一 HTML 網頁檔（圖片內嵌，離線與手機都能開）、Markdown（notes.md 加 images/ 的 zip，當部落格素材）。
・備份與還原：「全部備份」存成 zip，「從備份還原」讀回來；超過 14 天沒備份會用醒目顏色提醒。
・在其他頁面按快捷鍵會開啟筆記本。快捷鍵可以到 chrome://extensions/shortcuts 修改。

■ 隱私
・筆記（片名、秒數、台詞、心得）和截圖只存在你瀏覽器本機的擴充功能資料庫，不會上傳到任何伺服器。沒有帳號，沒有分析或追蹤。
・擴充功能唯一會主動讀網路資料的地方在 Netflix 頁面內、只讀不寫：讀這部片的片名資料，以及重新讀取頁面本來就載入過的進度條小圖（截圖的備案）。兩者都不含任何筆記內容。
・備份、匯出都是在本機產生檔案下載，不經過任何伺服器。
・移除擴充功能會連筆記和圖片一起刪掉，請定期按「全部備份」。

■ 已知限制
・這是依賴各網站頁面內部結構的做法，網站改版就可能讓部分功能失效；哪一項讀不到就只少那一項，記錄流程不會中斷。
・只在 macOS 的 Chrome 上實測過。
・在一個分頁第一次就用頁面上的按鈕時，Chrome 的 activeTab 規則可能讓它截不到完整畫面；先在這個分頁按一次快捷鍵或工具列圖示即可。
・不支援嵌在其他網站的影片、m.youtube.com、YouTube Music、youtu.be 短網址分頁。
・介面只有繁體中文。

■ 開源
MIT 授權。原始碼、使用說明與問題回報：https://github.com/bobo52310/resonnote

這是個人開源專案，與 Netflix、YouTube（Google）、Disney+ 無關，也未獲其背書或贊助。各名稱與商標屬各自的所有者，這裡僅用來說明本擴充功能支援的網站。擷取的畫面與台詞，版權屬原權利人，僅供個人筆記用途。
```

字數：1,221 字元（Unicode 碼位）。官方文件沒有寫說明欄的字數上限（**不確定**；儀表板輸入框會顯示計數，以畫面為準）。平台名稱出現次數：Netflix 3 次、YouTube 3 次（另有網址 m.youtube.com 一次）、Disney+ 2 次，都在官方「超過 5 次」的關鍵字濫用例子以下。

### 類別

建議主類別：**Lifestyle › Entertainment（生活 › 娛樂）**。

- 理由：使用情境是在串流網站看劇、看影片時記下片段，跟「看影音」這件事綁在一起；使用者會在娛樂類找看劇輔助工具。
- 備選：Productivity › Tools（生產力 › 工具），如果想強調「筆記、匯出成部落格素材」。
- 類別名稱是 2026-11-06 讀取商店分類頁標題確認的（`chromewebstore.google.com/category/extensions/lifestyle/entertainment` 的頁面標題是「Chrome Web Store - Entertainment」）；官方開發者文件沒有列出完整類別清單，儀表板下拉選單的中文譯名**不確定**，以畫面為準。

### 語言

**中文（繁體）／Chinese (Traditional)**。擴充功能介面只有繁體中文。

### 其他欄位

| 欄位 | 填什麼 |
|---|---|
| 首頁網址（Homepage URL） | `https://resonnote.bobochen.dev` |
| 支援網址（Support URL） | `https://github.com/bobo52310/resonnote/issues` |
| 官方網址（Official URL） | 選填。下拉選單只會出現已在 Google Search Console 驗證過的網站；要顯示就先驗證 `resonnote.bobochen.dev`。 |
| 成人內容（Mature content） | 不勾。 |
| 宣傳影片（YouTube video） | 選填。官方只收 YouTube 連結；要用 `website/public/media/intro.mp4` 的話要先上傳到 YouTube。 |

---

## English

用在之後加了 `_locales/en` 的英文版本商店資訊（見上方說明）。名稱與摘要要寫進 `_locales/en/messages.json`，再由 manifest 以 `__MSG_…__` 引用。

### Name (manifest `name`, max 75 characters)

```text
ResonNote 共鳴筆記
```

14 characters. Keep the bilingual brand name; the alternative `ResonNote` is 9 characters.

### Summary (manifest `description`, max 132 characters)

```text
Save the frame, timestamp, subtitle and your own note at the moment a scene moves you, on Netflix, YouTube and Disney+.
```

**119 characters** (119 code points, 119 UTF-16 units, 119 UTF-8 bytes; all ASCII). Counted with the same `python3` one-liner as above.

### Description

```text
ResonNote saves the moment a scene moves you. Press Alt+Shift+N (⌥⇧N on a Mac) on a watch page and it keeps the frame, the timestamp, the title and the subtitle line, plus your own note. It works on the watch pages of Netflix, YouTube and Disney+.

HOW IT WORKS
1. On a watch page, press the shortcut or click the toolbar icon. Moving the mouse also shows a 「記下這一刻」 ("save this moment") button on the page.
2. ResonNote takes the screenshot first, then pauses the video and opens a small panel with the frame, time, title and subtitle filled in. You can edit the subtitle.
3. Type a note (or leave it empty) and press Enter to save; the video plays on. Esc cancels without saving.

FEATURES
• Film strip: the panel shows up to two earlier notes of the same video. Click one to edit or delete it.
• Notebook: notes are grouped by platform and title, with season and episode for series. Click a time to go back to that second: an open tab of the same video is focused and paused there, otherwise a new tab opens. Notes can be edited in place and save automatically.
• Export: a PNG card for LINE (1080 px wide), a single self-contained HTML file that opens offline and on phones, or Markdown (notes.md plus an images/ folder in a zip) for blog posts.
• Backup and restore as a zip, with a highlighted reminder after 14 days without a backup.
• Pressing the shortcut on any other page opens the notebook. Change the shortcut at chrome://extensions/shortcuts.

PRIVACY
• Notes (title, time, subtitle, your note) and screenshots stay in the extension's local database in your browser. Nothing is uploaded to any server. No account, no analytics, no tracking.
• The only network reads the extension makes happen inside Netflix pages and never send anything: the title details of the video, and the progress-bar preview images the page has already loaded (a fallback picture). Neither contains any of your notes.
• Backups and exports are files created on your computer, without any server.
• Removing the extension deletes your notes and pictures, so back up regularly.

KNOWN LIMITATIONS
• It relies on how each site's pages are built internally, so a site redesign can break parts of it. If one item cannot be read, only that item is missing; saving still works.
• Tested only on Chrome for macOS.
• The first time you use the on-page button in a tab, Chrome's activeTab rule may block a full screenshot; press the shortcut or the toolbar icon once in that tab.
• Not supported: videos embedded in other sites, m.youtube.com, YouTube Music and youtu.be short-link tabs.
• The interface is in Traditional Chinese only.

OPEN SOURCE
MIT licensed. Source code, usage notes and issues: https://github.com/bobo52310/resonnote

ResonNote is a personal open-source project. It is not affiliated with, endorsed by or sponsored by Netflix, YouTube (Google) or Disney+. These names and trademarks belong to their owners and are used only to describe the supported sites. Captured frames and lines remain the property of their rights holders and are for personal notes only.
```

3,059 characters (code points); the dashboard's limit for this field is not stated in the official docs (**uncertain**). Platform names: Netflix 3, YouTube 3 (plus the `m.youtube.com` host once), Disney+ 2.

### Category

**Lifestyle › Entertainment**, for the same reason as above (used while watching shows and videos). Alternative: Productivity › Tools.

### Language

The English locale only exists after `_locales/en` is added. The extension UI stays Traditional Chinese, and the description says so.

---

## 宣稱與 README 的對照

每一項功能宣稱在 `README.md` 的出處（行號以 main `7a59746` 為準）：

| 宣稱 | README 出處 |
|---|---|
| ⌥⇧N 快捷鍵、可改、工具列圖示 | 第 29 行（manifest `suggested_key` 為 `Alt+Shift+N`） |
| 先截圖再暫停、跳出小視窗；頁面浮出「記下這一刻」按鈕 | 第 31、36 行 |
| Enter 存檔繼續播放、Esc 取消、台詞可改、心得可留空 | 第 40–47 行 |
| 抓到圖、台詞、片名（沒抓到會列出） | 第 49 行 |
| 膠卷小格：最多兩格、可修改、可刪除 | 第 50 行 |
| 其他頁面按快捷鍵開啟筆記本 | 第 35 行 |
| 依平台＋片子分組、影集標季集、跳回那一秒 | 第 54–57 行 |
| 心得直接改、自動存檔 | 第 58 行 |
| 圖卡 PNG 寬 1080、HTML 單檔離線、Markdown zip | 第 60–63 行 |
| 全部備份／從備份還原、14 天提醒 | 第 66、70 行 |
| 筆記只存本機、沒有帳號與追蹤；唯一網路請求在 Netflix 頁面內 | 第 74–77 行 |
| 移除會刪除筆記 | 第 70 行 |
| 依賴頁面內部結構、壞一項只少一項 | 第 82 行 |
| 只在 macOS 的 Chrome 實測 | 第 81 行 |
| activeTab 讓第一次用頁面按鈕截不到完整畫面 | 第 106–109 行 |
| 不支援嵌入影片、m.youtube.com、YouTube Music、youtu.be | 第 110 行 |
| 與三個平台無關、商標聲明、截圖版權 | 第 133–135 行 |
| MIT 授權 | 第 139 行 |
| 介面只有繁體中文 | 不是 README 條目，是程式現況：介面字串都是繁中，例如 `src/core/overlay/overlay.ts:445`、`src/notebook/view.ts:33` |
