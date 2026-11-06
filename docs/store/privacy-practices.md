# Chrome 線上應用程式商店：隱私權實務（Privacy practices）

開發人員資訊主頁的「隱私權實務／Privacy practices」分頁照下面填。表單建議**一律貼英文**（審查人員讀英文最穩），zh-TW 是給你自己對照用的。

查證日期：2026-11-06。對照的程式碼是 main `7a59746`，以及用 `pnpm build` 產生的 `.output/chrome-mv3/`。

官方依據：

- 隱私權分頁要填什麼：<https://developer.chrome.com/docs/webstore/cws-dashboard-privacy>
- 使用者資料 FAQ（含「只在本機處理也要揭露」）：<https://developer.chrome.com/docs/webstore/program-policies/user-data-faq>
- Limited Use：<https://developer.chrome.com/docs/webstore/program-policies/limited-use>
- 計畫政策全文：<https://developer.chrome.com/docs/webstore/program-policies/policies>
- 遠端程式碼（RHC）的定義：<https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code>
- Single purpose：<https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines-faq>

各英文段落字數（Unicode 碼位）：single purpose 524、activeTab 382、storage 338、unlimitedStorage 359、netflix.com 887、youtube.com 591、disneyplus.com 628、網站權限合併版 799。官方文件沒寫這些欄位的字數上限（**不確定**）；若儀表板顯示上限比這短，先刪括號裡的補充說明。

每段下方的 `<!-- Evidence -->` 註解列出程式位置（`檔案:行號`），在 GitHub 上看原始檔才看得到。

---

## 1. Single purpose（單一用途）

官方：「an extension must have a single purpose that is narrow and easy to understand」。

```text
ResonNote saves a moment from a video you are watching on Netflix, YouTube or Disney+. When you press its keyboard shortcut or toolbar button on a watch page, it captures the visible frame, the playback time, the title and the current subtitle line, and lets you add your own note. The notes are kept in a local notebook inside the extension, where you can jump back to that second of the video, edit the notes, export them as an image card, an HTML file or Markdown, and back them up. Everything stays on the user's device.
```

zh-TW 對照：ResonNote 讓你在 Netflix、YouTube、Disney+ 看影片時把一個片刻存下來。在播放頁按快捷鍵或工具列按鈕，就擷取當下畫面、播放秒數、片名和那句台詞，再讓你寫心得。筆記存在擴充功能內的本機筆記本，可以跳回影片的那一秒、修改、匯出成圖卡／HTML／Markdown、備份。所有資料都留在使用者的裝置上。

---

## 2. Permission justification（權限理由）

manifest：`permissions: ['activeTab', 'storage', 'unlimitedStorage']`、`host_permissions` 為三個 www 網域（`wxt.config.ts:12-17`）。沒有 `tabs`、`scripting`、`cookies`、`webRequest`、`<all_urls>`。

### activeTab

```text
Used only to take one screenshot of the visible tab with tabs.captureVisibleTab, right after the user presses the extension's keyboard shortcut (Alt+Shift+N) or clicks its toolbar icon on a video page. The screenshot is the picture saved with the note. activeTab limits this to the tab the user acted on, at the moment of that gesture. The extension never captures a tab on its own.
```

zh-TW：只用來在使用者按快捷鍵或點工具列圖示之後，用 `tabs.captureVisibleTab` 截一次目前分頁的畫面，當作筆記的圖。activeTab 只放行使用者動作的那個分頁、那一刻；擴充功能不會自己去截任何分頁。

<!-- Evidence:
  src/entrypoints/background.ts:75-76  captureVisibleTab(windowId, { format: 'jpeg', quality: 90 })
  src/entrypoints/background.ts:114-117 action.onClicked -> trigger (comment: "Both this and the shortcut grant `activeTab`")
  src/entrypoints/background.ts:119-122 commands.onCommand('capture-scene') -> trigger
  src/background/trigger.ts:95          the only caller of captureVisibleTab
  README.md:106-109                     on-page button without a prior shortcut press cannot take the full screenshot
-->

### storage

```text
chrome.storage.local holds a single value: the date of the user's last backup (key "lastBackupAt"). The notebook page shows it and reminds the user to back up when it is more than 14 days old. The notes themselves are not kept in chrome.storage; they are in the extension's own IndexedDB on the device. Nothing is synced or sent anywhere.
```

zh-TW：`chrome.storage.local` 只存一個值：上次備份的時間（`lastBackupAt`），筆記本用它顯示「上次備份」並在超過 14 天時提醒。筆記本身不在 chrome.storage，而在擴充功能自己的 IndexedDB。不同步、不外傳。

<!-- Evidence:
  src/core/backup.ts:12       const LAST_BACKUP_KEY = 'lastBackupAt'
  src/core/backup.ts:209      browser.storage.local.get(LAST_BACKUP_KEY)
  src/core/backup.ts:215      browser.storage.local.set({ [LAST_BACKUP_KEY]: iso })
  grep -rn "storage\.\(sync\|session\)" src  -> no matches
-->

### unlimitedStorage

```text
Every note includes a JPEG screenshot, stored with the note in the extension's IndexedDB on the user's device. Users collect hundreds of notes over time, so the database can grow large. unlimitedStorage keeps the browser from capping or evicting this local data, which would otherwise silently delete the user's notes and pictures. No data is stored remotely.
```

zh-TW：每則筆記都帶一張 JPEG 截圖，跟筆記一起存在擴充功能的本機 IndexedDB。筆記累積多了資料庫會變大；unlimitedStorage 讓瀏覽器不會對這份本機資料設上限或清除，否則使用者的筆記和圖會無聲消失。沒有任何資料存在遠端。

<!-- Evidence:
  src/core/db.ts:5-11   IndexedDB "scenenote" with stores notes and images (images: raw JPEG bytes)
  src/core/db.ts:17-21  openDB / createObjectStore('notes'), createObjectStore('images')
  README.md:70          notes live in the extension's IndexedDB; removing the extension deletes them
  Note: "the browser may cap or evict without it" is the general reason for this permission; no quota error from this extension was measured.
-->

### Host permission: `https://www.netflix.com/*`

```text
Content scripts run on Netflix pages to: show the "save this moment" button and the note panel on watch pages; read the current playback time, the title and the subtitle line shown by the player; pause, resume and seek the video. A small script in the page's own context reads the player's state, because the player is not reachable from the isolated world. On Netflix only, that script makes two read-only same-site requests: the title details of the current video from netflix.com, and the progress-bar preview file the page itself has already loaded, used as a fallback picture when the full screenshot fails. No note content is ever sent. The host permission also lets the extension find an already open Netflix watch tab (tabs.query with a URL pattern) when the user clicks a time in the notebook, so it can switch to that tab and seek to that second instead of opening a duplicate.
```

zh-TW：內容腳本在 Netflix 頁面上：在播放頁顯示「記下這一刻」按鈕和小視窗；讀播放器當下的秒數、片名、台詞；暫停、播放、跳秒。因為播放器在隔離環境（isolated world）讀不到，另有一支在頁面環境（MAIN world）的小腳本讀播放器狀態。只有在 Netflix，這支腳本會發兩種同站、只讀的請求：向 netflix.com 讀這部片的片名資料，以及重讀頁面自己已經載入過的進度條預覽圖檔（完整截圖失敗時的備案圖）。不送出任何筆記內容。網站權限也讓擴充功能在使用者點筆記本的時間按鈕時，用 `tabs.query` 找到已開著的 Netflix 播放分頁，切過去跳到那一秒，而不是重開一個。

<!-- Evidence:
  src/entrypoints/netflix.content.ts:8          matches: ['https://www.netflix.com/*']
  src/entrypoints/netflix-bridge.content.ts:5-6 matches netflix, world: 'MAIN'
  src/platforms/netflix/page-bridge.ts:25       metadataUrl = `/nq/website/memberapi/release/metadata?movieid=${movieId}` (relative, same origin)
  src/platforms/netflix/page-bridge.ts:123      win.fetch(metadataUrl(movieId), { credentials: 'include' })
     - a same-origin request from the page context; the browser attaches the user's own Netflix cookies as for any
       request the page makes. The extension never reads, stores or sends cookies. Mention if a reviewer asks.
  src/platforms/netflix/page-bridge.ts:18,196,214-219  .bif URL taken from performance.getEntriesByType('resource'), then win.fetch(url)
  src/entrypoints/background.ts:88              tabs.query({ url: patterns })
  src/platforms/registry.ts:28                  Netflix tab patterns
  README.md:75                                  the only network reads, both inside Netflix pages, read-only
-->

### Host permission: `https://www.youtube.com/*`

```text
Content scripts run on YouTube pages to show the "save this moment" button and the note panel on watch pages (including Shorts and live URLs), read the playback time, the title and the caption line shown by the player, and pause, resume and seek the video. A small script in the page's own context calls the player's methods, which are not reachable from the isolated world. The extension makes no network requests on YouTube. The host permission also lets it find an already open YouTube watch tab when the user clicks a time in the notebook, so it can switch to it and seek to that second.
```

zh-TW：內容腳本在 YouTube 頁面上顯示按鈕與小視窗（含 Shorts、直播網址），讀播放秒數、片名、字幕那一句，暫停、播放、跳秒；頁面環境的小腳本用來呼叫播放器方法。擴充功能在 YouTube 上不發任何網路請求。網站權限也用來在點筆記本時間按鈕時找到已開著的 YouTube 播放分頁並跳到那一秒。

<!-- Evidence:
  src/entrypoints/youtube.content.ts:8          matches: ['https://www.youtube.com/*']
  src/entrypoints/youtube-bridge.content.ts:5-6 world: 'MAIN'
  src/platforms/registry.ts:37-39               watch*, shorts/*, live/* tab patterns
  grep -n "fetch(" src/platforms/youtube/*.ts   -> no matches; README.md:75 "YouTube、Disney+ 頁面內沒有任何擴充功能發出的網路請求"
-->

### Host permission: `https://www.disneyplus.com/*`

```text
Content scripts run on Disney+ pages to show the "save this moment" button and the note panel on watch pages, read the playback time, the title, season and episode and the subtitle line from the player, and pause, resume and seek the video. A small script in the page's own context reads the player's state, which is not reachable from the isolated world. The extension makes no network requests on Disney+. The host permission also lets it find an already open Disney+ tab when the user clicks a time in the notebook; because Disney+ links cannot carry a start time, the extension asks the opened player to seek to that second.
```

zh-TW：內容腳本在 Disney+ 頁面上顯示按鈕與小視窗，讀播放秒數、片名、季集、台詞，暫停、播放、跳秒；頁面環境的小腳本讀播放器狀態。擴充功能在 Disney+ 上不發網路請求。網站權限也用來在點筆記本時間按鈕時找到已開著的 Disney+ 分頁；Disney+ 的連結帶不了秒數，所以由擴充功能叫開好的播放器跳到那一秒。

<!-- Evidence:
  src/entrypoints/disney.content.ts:8          matches: ['https://www.disneyplus.com/*']
  src/entrypoints/disney-bridge.content.ts:5-6 world: 'MAIN'
  src/platforms/registry.ts:49                 Disney+ tab pattern
  src/background/jump.ts:21-35                 seek request sent once a second until it takes (README.md:57)
-->

### 若儀表板只給一個「Host permission」欄位

儀表板可能把三個網站權限合成一個理由欄（**不確定**，以畫面為準；欄位字數上限官方文件也沒寫）。那就貼這段合併版：

```text
The three host permissions (www.netflix.com, www.youtube.com, www.disneyplus.com) are the only sites ResonNote supports. On their watch pages, content scripts show the "save this moment" button and the note panel, read the playback time, title and subtitle line from the player, and pause, resume and seek the video; a small page-context script is needed because the players are not reachable from the isolated world. The same access lets the notebook find an already open watch tab (tabs.query by URL) and seek it to a saved second. The only network requests are made on Netflix: two read-only same-site requests, for the video's title details and for the progress-bar preview file the page has already loaded (a fallback picture). No note content leaves the device, and no other site is requested.
```

### 為什麼不能只靠 activeTab（審查人員若問）

```text
activeTab only grants access after a user gesture and only until the tab navigates. ResonNote's on-page button and its panel must already be on the watch page before the user acts, and the notebook must reach an already open watch tab (focus it and seek) when the user clicks a time, which happens from the extension's own page, not from a gesture on that tab. The host permissions are limited to the three www hosts the extension supports; it does not request <all_urls> or any other site.
```

---

## 3. Remote code（遠端程式碼）

選：**No, I am not using remote code.**

官方定義（remote-hosted-code 頁）：「Remotely hosted code, or RHC, is what the Chrome Web Store calls anything that is executed by the browser that is loaded from someplace other than the extension's own files. Things like JavaScript and WASM. It does not include data or things like JSON or CSS.」

依據：

- 所有 JavaScript 都由 WXT 打包在 zip 裡；`.output/chrome-mv3/manifest.json` 沒有 `content_security_policy` 的放寬設定。
- 原始碼與打包結果都沒有 `eval(`、`new Function(`、`importScripts(`、動態建立 `<script>`（指令：`grep -rlE "eval\(|new Function\(|importScripts\(" .output/chrome-mv3` 無結果；`grep -rn "createElement('script')" src` 無結果）。
- 唯一的 `fetch` 是 Netflix 頁面內的兩個只讀請求，回來的是 JSON（片名資料）與二進位圖檔（`.bif` 預覽圖），都只當資料解析，不執行（`src/platforms/netflix/page-bridge.ts:123-125, 196-199`）。
- 打包後的筆記本頁 `chunks/options-*.js` 裡另有一個 `fetch(e.href, …)`：那是 Vite 的 modulepreload polyfill，只預先抓頁面上 `<link rel="modulepreload">` 指向的擴充功能自己的檔案，不是遠端程式碼。
- 打包結果裡出現的網址只有 `www.netflix.com`、`www.youtube.com`、`www.disneyplus.com`（播放網址與分頁比對樣式）和 SVG 命名空間 `http://www.w3.org/2000/svg`。

---

## 4. Data usage（資料使用）

### 「collect」怎麼算：只在本機處理也要揭露

官方的使用者資料 FAQ 第 3 題原文：

> Does an extension need to disclose user data handling if the data is only processed or stored locally on a user's device?
> Yes. Extensions are required to disclose how they handle user data, even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties.

同一份 FAQ 第 2 題把「handle」定義為「collecting, transmitting, using, or sharing user data」，例子包括「Clipping or scraping content from a website that the user visits, such as taking screenshots or capturing data from a web page」。ResonNote 截圖、讀台詞片名正是這一類，所以**即使資料不離開裝置，也要照實勾選**，不能因為「沒有上傳」就全部不勾。官方也說隱私欄位若與擴充功能行為或隱私權政策矛盾，可能被下架（<https://developer.chrome.com/docs/webstore/program-policies/listing-requirements>）。

儀表板上各資料類別的名稱與說明文字，官方公開文件沒有列出（**不確定**，下表的類別名稱是儀表板慣用名稱，送審時以畫面上的文字為準）。

### 勾選建議

| 類別 | 建議 | 理由 |
|---|---|---|
| Personally identifiable information | 不勾 | 不收姓名、Email、帳號等；沒有帳號系統。 |
| Health information | 不勾 | 無。 |
| Financial and payment information | 不勾 | 無付費、不碰付款資訊。 |
| Authentication information | 不勾 | 不讀、不存密碼或 cookie。Netflix 片名請求是頁面同源請求，由瀏覽器自己帶 cookie，擴充功能碰不到（`page-bridge.ts:123`）。 |
| Personal communications | 不勾 | 不讀信件、訊息。 |
| Location | 不勾 | 不取 IP、GPS、地區。 |
| **Web history** | **勾（保守）** | 每則筆記存了「哪個平台、哪支影片（影片代碼）、片名、建立時間」（`src/core/types.ts:6-13`），等於記下使用者看過的頁面與時間。只在使用者按下記錄時存一筆，不收一般瀏覽紀錄。這項是判斷題（**不確定**）：不勾也說得通，但勾了不會和行為矛盾。 |
| User activity | 不勾 | 滑鼠移動只用來顯示／隱藏頁面按鈕，鍵盤只處理自己的快捷鍵與小視窗輸入；都不記錄、不保存。 |
| **Website content** | **勾** | 擷取播放頁的畫面（截圖）、播放器顯示的台詞與片名，存成筆記（`src/background/trigger.ts:95`、`src/core/db.ts:8-11`）。 |

使用者自己寫的「心得」屬使用者產生的內容；儀表板的類別裡沒有對應項目（FAQ 第 4 題的例子有列 user-generated content），在隱私權政策裡寫清楚即可。

### 三項 certification（聲明）

儀表板第二組勾選框要你保證遵守 Limited Use。依官方文件，揭露內容包括「Your certification that the extension complies with the policy on limited use」（cws-dashboard-privacy）。畫面上的三句話官方文件沒有逐字列出（**不確定**，下面是常見的三句，以畫面為準），三句都照實**全部勾選**：

| 聲明（以儀表板為準） | 為什麼可以勾 | 對應政策條文（Limited Use） |
|---|---|---|
| I do not sell or transfer user data to third parties, outside of the approved use cases | 資料不離開裝置，沒有第三方 | 「Only transfer user data to third parties: If necessary to providing or improving your single purpose; …」 |
| I do not use or transfer user data for purposes that are unrelated to my item's single purpose | 只用來做筆記、跳回、匯出、備份 | 「Limit your use of user data to providing or improving your single purpose」 |
| I do not use or transfer user data to determine creditworthiness or for lending purposes | 完全無關 | 「Transferring, using, or selling user data to determine credit-worthiness or for lending purposes.」列為禁止 |

另外兩條相關規定：

- **網站上要有 Limited Use 聲明**：計畫政策要求「An affirmative statement that your use of the data complies with the Limited Use restrictions must be disclosed on a website belonging to your extension」（<https://developer.chrome.com/docs/webstore/program-policies/policies>）。送審前請確認隱私權政策頁有類似這句話（官方範例原文是「The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.」；ResonNote 沒用 Google API，可改寫成「ResonNote's use of data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.」）。
- **Prominent disclosure（顯著揭露）**：政策要求處理使用者資料前要顯著揭露並取得同意。ResonNote 只在使用者主動按快捷鍵／按鈕時才擷取，商店說明的「隱私」段也寫清楚了。官方的違規排除頁寫「Prominent disclosure of data collection in the extension's Chrome Web Store listing is sufficient.」（<https://developer.chrome.com/docs/webstore/troubleshooting>），但舊的 FAQ 第 10 題又說商店說明不算數，兩份文件說法不一致（**不確定**）。若被以此退件，再考慮在擴充功能首次使用時加一段說明（屬程式變更）。

---

## 5. Privacy policy URL（隱私權政策網址）

```text
https://resonnote.bobochen.dev/privacy/
```

- 這頁由另一個工作建立；送審前要確定網址打得開、內容講到「收集什麼、怎麼用、分享給誰（沒有）」，並和上面的勾選一致。官方常見退件原因包括「The privacy policy URL is not working」「The privacy policy is not provided in the designated field」（不能只寫在說明裡）（<https://developer.chrome.com/docs/webstore/troubleshooting>）。
- 官方 FAQ 第 14 題：只存在本機的擴充功能也要有隱私權政策，「It just needs to describe how the Product collects, uses, and shares user data.」
