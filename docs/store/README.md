# 上架 Chrome 線上應用程式商店：素材包與送審步驟

給 ResonNote 共鳴筆記第一次上架用。照「送審步驟」一步步做；要貼的文字在 [`listing.md`](listing.md)（商店資訊）和 [`privacy-practices.md`](privacy-practices.md)（隱私權實務），圖片在 [`images/`](images/)。

查證日期：2026-11-06。官方規範與儀表板畫面會改，送審當下以畫面為準。

## 素材清單

| 檔案 | 用在哪 | 規格（官方） | 狀態 |
|---|---|---|---|
| `images/store-icon-128.png` | 商店圖示（必填） | 128×128 PNG；方形圖案約 96×96，四周各 16 px 透明留白；深淺背景都要清楚；不要自己加外框 | **由 Codex 設計**，檔名 `images/store-icon-128.png` |
| `images/screenshot-1.png` | 截圖 1：記下這一刻的小視窗 | 1280×800（或 640×400），直角、滿版不留白；至少 1 張、最多 5 張 | 已完成 |
| `images/screenshot-2.png` | 截圖 2：膠卷小格回看前面的筆記 | 同上 | 已完成 |
| `images/screenshot-3.png` | 截圖 3：筆記本分組、點時間跳回那一秒 | 同上 | 已完成 |
| `images/screenshot-4.png` | 截圖 4：匯出圖卡、網頁檔、Markdown | 同上 | 已完成 |
| `images/screenshot-5.png` | 截圖 5：三個平台同一個按鍵 | 同上 | 已完成 |
| `images/promo-small-440x280.png` | 小型宣傳圖塊（選填，但沒有的話排在有的後面） | 440×280 PNG 或 JPEG；少放字、縮到一半仍看得清楚、填滿整塊 | **由 Codex 設計**，檔名 `images/promo-small-440x280.png` |
| `images/promo-marquee-1400x560.png` | 大型宣傳圖塊 Marquee（選填，沒有就不會被選進首頁輪播） | 1400×560 PNG 或 JPEG | **由 Codex 設計**，檔名 `images/promo-marquee-1400x560.png` |
| `listing.md` | 名稱、摘要、說明、類別、語言、網址 | 名稱 ≤ 75、摘要 ≤ 132 字元 | 已完成 |
| `privacy-practices.md` | 單一用途、權限理由、遠端程式碼、資料使用、隱私權政策網址 | — | 已完成 |

規格出處：<https://developer.chrome.com/docs/webstore/images>、<https://developer.chrome.com/docs/webstore/cws-dashboard-listing>、<https://developer.chrome.com/docs/webstore/best-listing>。宣傳圖塊不能分語言（「The small tile and Marquee promo tile cannot be localized.」），截圖可以。

### 截圖怎麼做的

- 畫面是擴充功能**真正的介面程式**畫出來的：小視窗用 `src/core/overlay/overlay.ts` 的 `openOverlay`，筆記本用 `src/notebook/view.ts` 的 `renderNotebook` 加上選項頁 `src/entrypoints/options/index.html` 的 CSS（深色模式），圖卡用 `src/export/card.ts` 的 `renderCard`。在本機無頭 Chrome（headless Chrome）裡餵假筆記渲染，再加上 zh-TW 標題。截圖 5 是用品牌視覺另外排版的示意（平台名稱是純文字）。
- 劇照是 `docs/design/promo-intro-zh-tw/assets/` 的 AI 生成原創畫面，片名、台詞都是虛構的。畫面裡沒有任何 Netflix、YouTube、Disney+ 的 logo、真實介面或影集畫面。
- 品牌圖示可能會換，所以截圖裡沒有放圖示，只在右上角放「ResonNote 共鳴筆記」文字。
- 產生截圖的工具（Vite 開發伺服器＋DevTools Protocol 截圖）沒有放進 repo：根目錄 `tsconfig` 的 include 是 `../**/*`，`docs/` 底下放 `.ts` 會被 `pnpm compile` 一起檢查。之後介面改版要重拍，照上面的方式重做即可。

## 送審步驟

### 1. 註冊開發者帳號（一次性）

1. 用要長期管理的 Google 帳號打開 <https://chrome.google.com/webstore/devconsole>。官方建議用**專門發布用的 Email**，而且「After an account is created, you cannot change its email address.」（<https://developer.chrome.com/docs/webstore/register>）
2. 同意開發者協議與政策，付**一次性註冊費**。
   - 金額：**US$5**。出處是官方 Chromium Blog（2020-03）：「The Chrome Web Store charges a $5.00 fee to register as a Chrome Web Store developer.」（<https://blog.chromium.org/2020/03/new-developer-dashboard-and.html>）。目前的官方註冊頁只寫「pay a one-time registration fee」，沒寫金額，所以以付款畫面為準。查證日期 2026-11-06。
   - 台灣在官方支援的註冊國家清單內（同一頁）。
3. 到儀表板左側「Account」填：發布者名稱（Publisher name，會顯示在「Offered by:」）、**驗證聯絡 Email**（必填）（<https://developer.chrome.com/docs/webstore/set-up-account>）。實體地址只有販售商品或訂閱的項目才需要，ResonNote 不用。
4. 如果儀表板要你申報 trader／non-trader（歐盟數位服務法的交易者身分），官方文件這次沒查到細節（**不確定**）；免費的個人開源專案通常選 non-trader，照畫面說明判斷。

### 2. 打包商店版 zip

商店版**不能帶 manifest 的 `key`**（`key` 是讓從原始碼載入的開發版 ID 固定用的，商店會自己指派 ID）。用 repo 的 script 產生：

```sh
pnpm install --frozen-lockfile
pnpm zip:store
# 產出 .output/resonnote-<版本>-chrome-store.zip，版本取自 package.json

# 檢查：manifest 在 zip 根目錄、沒有 key（把 0.1.1 換成實際版本）
unzip -l .output/resonnote-0.1.1-chrome-store.zip | head
unzip -p .output/resonnote-0.1.1-chrome-store.zip manifest.json | grep -c '"key"'   # 應該印出 0
```

### 3. 建立項目、上傳 zip

儀表板按「Add new item」→ 選 zip → Upload（<https://developer.chrome.com/docs/webstore/publish>）。套件上限 2 GB；新發布者最多只能有兩個已發布的擴充功能。

### 4. 填「商店資訊／Store listing」

照 [`listing.md`](listing.md)：

- 名稱、摘要會自動帶入 manifest 的 `name`、`description`，確認顯示的是「ResonNote 共鳴筆記」和 53 字元的摘要。
- 貼繁體中文詳細說明；類別選 Lifestyle › Entertainment；語言選中文（繁體）。
- 上傳圖片：商店圖示 `store-icon-128.png`、截圖 `screenshot-1.png` 到 `screenshot-5.png`（照編號排）、`promo-small-440x280.png`、`promo-marquee-1400x560.png`。
- 首頁網址 `https://resonnote.bobochen.dev`、支援網址 `https://github.com/bobo52310/resonnote/issues`。Official URL 選填，要先在 Search Console 驗證網域。
- 成人內容不勾。

### 5. 填「隱私權實務／Privacy practices」

照 [`privacy-practices.md`](privacy-practices.md) 貼英文：單一用途、6 個權限各自的理由（activeTab、storage、unlimitedStorage、三個網站）、遠端程式碼選「No」、資料使用勾 Website content 與 Web history（後者是保守選擇，理由見該檔）、三項聲明全勾、隱私權政策網址 `https://resonnote.bobochen.dev/privacy/`。

送審前先確認隱私權政策頁打得開，而且內容和勾選一致、有 Limited Use 的聲明句。

### 6. 填「發布／Distribution」

（<https://developer.chrome.com/docs/webstore/cws-dashboard-distribution>）

- 付費：免費。
- 曝光度（Visibility）：要公開就選 **Public**；想先給少數人試用可以選 **Unlisted**（不會出現在商店搜尋，有網址就能裝）或 **Private**（只有指定的測試者）。官方：「All visibility settings have the same policy requirements and will go through the same review process.」
- 地區：建議 All regions。介面只有繁體中文，若只想給台灣、香港等地區，可以取消 All regions 後逐一勾選。

### 7. 填「測試說明／Test instructions」（選填，建議填）

審查人員不一定有 Netflix、Disney+ 帳號，而介面是繁中，附上這段英文可以減少「功能無法使用」的退件：

```text
The extension needs no account or login of its own. YouTube is the quickest way to test because it needs no sign-in.
1. After installing, open any public YouTube video (a tab that was already open must be reloaded once, because content scripts are not injected into existing tabs). Turn on CC if you want a subtitle line to be picked up.
2. Press Alt+Shift+N, or click the ResonNote toolbar icon. The extension takes a screenshot, pauses the video and opens a panel with the frame, time, title and subtitle line.
3. Type a note and press Enter. The video resumes. Esc cancels.
4. Press Alt+Shift+N on any non-video page, or open the extension's options page, to see the notebook. Click the time button of a note to go back to that second.
Netflix and Disney+ work the same way but need a subscription.
The interface is in Traditional Chinese: 記下這一刻 = "save this moment", 開啟筆記本 = "open notebook", 全部備份 = "back up everything", 匯出網頁檔 = "export HTML", 匯出 Markdown = "export Markdown".
Source code: https://github.com/bobo52310/resonnote
```

### 8. 送審

按「Submit for review」。確認視窗可以取消勾選「審查通過後自動發布」，改成自己決定發布時間；審查通過後 30 天內要發布，否則退回草稿要重送（<https://developer.chrome.com/docs/webstore/publish>）。

官方說大部分在幾天內審完，最長可能幾週；新開發者、新擴充功能會被看得比較仔細；超過三週還在審可以聯絡開發者支援（<https://developer.chrome.com/docs/webstore/review-process>）。

## 上架之後

1. **擴充功能 ID 會不同**：從原始碼載入的開發版 ID 固定是 `bldeoidbgkcdnmiholglmknnimdhnhff`（README「開發」一節），商店版的 ID 由商店指派，跟它不一樣。筆記存在各自 ID 的 IndexedDB，**不會自動搬過去**。搬移方法：
   1. 在 GitHub 版的筆記本按「全部備份」，存好 zip。
   2. 安裝商店版，打開它的筆記本，按「從備份還原」選那個 zip（`id` 相同的筆記以 `updatedAt` 較新的為準）。
   3. 確認筆記與圖都在之後，再到 `chrome://extensions` 停用或移除 GitHub 版。兩個版本同時啟用時，播放頁上會有兩份內容腳本，快捷鍵也可能只分配給其中一個（**不確定**實際行為，避免同時啟用就好）。注意：移除 GitHub 版會刪掉它自己的筆記，一定要先確認還原成功。
2. **回來更新連結**：拿到商店網址（格式為 `https://chromewebstore.google.com/detail/<ID>`）後，另開工作更新：
   - repo `README.md` 的「安裝」一節，加上「從 Chrome 線上應用程式商店安裝」，原始碼安裝保留給開發者。
   - 網站 `website/`（例如安裝區塊 `website/src/components/Install.astro`）加商店連結。
3. 之後每次更新都要升 `package.json` 的 `version`、重新 `pnpm zip:store` 上傳，一樣會經過審查。

## 可能被退件的風險與預先準備的說明

| 風險 | 為什麼可能被問 | 預先準備（英文可直接回覆審查） |
|---|---|---|
| 依賴第三方網站內部結構 | 頁面環境（MAIN world）的腳本讀播放器內部 API；Netflix 頁面內會向 netflix.com 讀片名資料 | 「The page-context scripts only read the player state the site already exposes to the page (time, title, subtitle) and call pause/play/seek, so the user can save a moment and jump back to it. They run only on the three supported hosts, only read, and send nothing off the device. If a site changes, the affected item is simply left empty.」 |
| 擷取受版權保護的內容 | 使用者會截下影集畫面與台詞 | 「It captures one frame of what the user is already watching, for the user's own notes, stored only on the user's device. It does not download video or subtitle files and does not bypass DRM; when the full screenshot is unavailable on Netflix it falls back to the small progress-bar preview images the page itself has already loaded.」說明的最後一段也寫了版權屬原權利人、僅供個人筆記用途。 |
| 商店截圖的著作權 | 截圖若出現真實影集畫面或平台介面會有侵權疑慮 | 全部用 AI 生成的原創劇照與虛構片名，沒有平台 logo 或真實介面（見上方「截圖怎麼做的」）。 |
| 商標、冒充 | 說明裡出現 Netflix、YouTube、Disney+ | 名稱不含平台名；說明寫明「與 Netflix、YouTube、Disney+ 無關」；平台名稱每個 ≤ 3 次，低於官方關鍵字濫用例子的「超過 5 次」（<https://developer.chrome.com/docs/webstore/program-policies/listing-requirements>）。 |
| 隱私欄位與行為、政策不一致 | 官方：隱私欄位與政策或行為矛盾可能下架 | 三份文字（商店說明「隱私」段、隱私權實務、隱私權政策頁）都寫同一套事實：只存本機、唯一網路請求在 Netflix 頁面內、只讀。 |
| 「只存本機」卻勾了資料類別，或反過來 | 官方 FAQ 說只在本機處理也要揭露 | 照 `privacy-practices.md` 勾 Website content 與 Web history，理由附官方原文。 |
| 審查人員無法測試 | 沒有串流訂閱、看不懂繁中介面 | 第 7 步的測試說明：用 YouTube 測、附介面翻譯。 |
| 權限 | 三個網站權限＋頁面環境腳本 | 不是官方說的廣泛網站權限（`<all_urls>`、`*://*/*`），只有三個 www 網域；每個權限的理由附程式位置。 |
| 程式碼經過壓縮 | WXT 打包會壓縮（minify） | 官方允許壓縮，但會讓審查較慢；測試說明裡附開源 repo 連結供對照（<https://developer.chrome.com/docs/webstore/review-process>）。 |
| zip 帶了 `key` | 開發版 manifest 固定了 `key` | 只用 `pnpm zip:store` 的產物，上傳前跑第 2 步的 `grep -c '"key"'` 檢查。 |
| 隱私權政策網址失效 | 常見退件原因之一 | 送審前打開 `https://resonnote.bobochen.dev/privacy/` 確認（<https://developer.chrome.com/docs/webstore/troubleshooting>）。 |

退件時，儀表板與 Email 會附違規代碼；官方的違規排除頁按代碼列出常見原因與修法：<https://developer.chrome.com/docs/webstore/troubleshooting>。
