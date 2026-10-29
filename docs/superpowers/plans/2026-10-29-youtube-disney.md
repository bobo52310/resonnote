# ResonNote v1.1（YouTube＋Disney+）Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 YouTube 與 Disney+ 播放頁也能記下這一刻、跳回、匯出；Netflix 行為不變。

**Spec:** `docs/superpowers/specs/2026-10-29-youtube-disney-design.md`（§2 是實測事實，§3 是決定）。v1 spec 與 v1 計畫仍適用於沒提到的部分。

**Branch:** `feat/youtube-disney`（從 `main` 4b1219d 開出）。基準：29 個測試檔、501 個測試全過，`pnpm compile` 無錯。

## Global Constraints

- 介面文字繁體中文；程式碼、識別字、註解、commit message 英文。註解密度與語氣照現有程式碼（說明「為什麼」，不逐行解說）。
- TypeScript strict；不得用 `any` 規避型別；不加新套件。
- 權限：只能在 `host_permissions` 加 `https://www.youtube.com/*`、`https://www.disneyplus.com/*`，其他權限不得新增。
- 平台轉接層、頁面橋接的方法失敗時回 `null` / `false` / `''`，不丟例外；console 訊息一律以 `[scenenote]` 開頭。
- 不得使用 `alert` / `confirm` / `prompt`。
- 不得停用、跳過、刪除既有測試來讓測試通過；既有測試因介面改名而需要改寫時，保留原本驗證的行為。
- 每個 task 結束：`pnpm test` 全過、`pnpm compile` 無錯，然後 commit（conventional commit，英文）。不 push。

## Shared Interfaces（各 task 必須照這裡的名稱與形狀做，後面的 task 依賴它們）

```ts
// src/core/types.ts
export type Platform = 'netflix' | 'youtube' | 'disney';
export type ImageSource = 'tab' | 'frame' | 'trickplay' | 'none';

// src/platforms/registry.ts  (pure; no browser APIs)
export interface PlatformInfo {
  id: Platform;
  /** 'Netflix' | 'YouTube' | 'Disney+' */
  label: string;
  parseWatchVideoId(url: string | undefined): string | null;
  watchUrl(videoId: string, timeMs: number): string;
  /** True when watchUrl itself starts playback at timeMs (Netflix, YouTube); false for Disney+. */
  linkKeepsTime: boolean;
  /** Match patterns for browser.tabs.query({ url }) that cover every watch page of the platform. */
  tabPatterns: string[];
}
export const PLATFORM_INFO: Record<Platform, PlatformInfo>;
export function isPlatform(value: unknown): value is Platform;
export function detectWatchPage(url: string | undefined): { platform: Platform; videoId: string } | null;
/** 「在 Netflix 從 16:43 開始看」, 「在 YouTube 從 16:43 開始看」, 「在 Disney+ 打開（這一刻在 16:43）」 */
export function watchLinkText(platform: Platform, timeMs: number): string;

// src/core/messages.ts (changed members)
| { type: 'scenenote/jump'; platform: Platform; videoId: string; timeMs: number }
| { type: 'scenenote/recent'; platform: Platform; videoId: string; limit: number }

// src/platforms/types.ts — PlatformAdapter gains one optional method
/** JPEG bytes of the current frame taken straight from the <video> (no subtitles), or null (DRM, no video). */
grabFrame?(): Promise<Uint8Array | null>;

// src/platforms/bridge-protocol.ts (moved from src/platforms/netflix/bridge-protocol.ts)
export type BridgeOp = 'playback' | 'pause' | 'play' | 'seek' | 'trickplay' | 'frame';
export function callBridge<T>(op: BridgeOp, timeMs?: number, timeoutMs?: number): Promise<T | null>;
/** callBridge that cannot reject (moved from the Netflix adapter's private `ask`). */
export function askBridge<T>(op: BridgeOp, timeMs?: number, timeoutMs?: number): Promise<T | null>;
// isBridgeRequest, isBridgeResponse, selfOrigin, warnOnce, REQUEST_SOURCE, RESPONSE_SOURCE stay as they are.

// src/core/hide-ui.ts (moved from src/platforms/netflix/hide-ui.ts)
export function hidePlayerUi(root: Element, keep: string): () => void;

// src/platforms/language-reactor.ts (moved out of src/platforms/netflix/subtitle.ts)
export function cleanLanguageReactorText(raw: string): string;
/** Language Reactor's line (#lln-main-subs .lln-subs-text, .translit removed, cleaned), or ''. */
export function extractLanguageReactorSubtitle(doc: Document): string;

// src/core/content-main.ts (extracted from src/entrypoints/netflix.content.ts)
export interface ContentScriptOptions {
  platform: Platform;
  adapter: PlatformAdapter;
  /** Whether the page currently plays something that can be noted (quick button visibility). */
  isWatchPage: () => boolean;
  /** The element the quick button sits in (bottom-right corner); omitted = viewport (v1 behaviour). */
  quickButtonAnchor?: () => Element | null;
}
export function runContentScript(opts: ContentScriptOptions): void;
```

## Task 1：平台底層（資料、登錄表、背景程式、筆記本、匯出、備份）

**Files:** `src/core/types.ts`、`src/platforms/registry.ts`（新）、`src/platforms/youtube/url.ts`（新）、`src/platforms/disney/url.ts`（新）、`src/core/messages.ts`、`src/background/{trigger,jump,recent}.ts`、`src/entrypoints/background.ts`、`src/notebook/{group,view,jump-client}.ts`、`src/export/{html,markdown}.ts`、`src/core/backup.ts`、`src/core/overlay/overlay.ts`（只改 `playerApi` 那句文字）、`wxt.config.ts`，與對應測試。

- [x] `Platform`、`ImageSource` 照 Shared Interfaces。`src/core/capture-controller.ts` 這個 task 先不動（它仍寫 `platform: 'netflix'`，型別相容）。
- [x] YouTube 網址（spec §3.2）：host 只認 `www.youtube.com` 與 `youtube.com`；`/watch?v=<id>`、`/shorts/<id>`、`/live/<id>`，id 為 `^[A-Za-z0-9_-]{11}$`；其他（含 `/embed/`、`m.youtube.com`、`music.youtube.com`、`youtu.be`）回 `null`。`watchUrl` → `https://www.youtube.com/watch?v=<id>&t=<floor 秒>s`。`tabPatterns` 至少涵蓋 `https://www.youtube.com/watch*`、`https://www.youtube.com/shorts/*`、`https://www.youtube.com/live/*`。
- [x] Disney+ 網址：origin `https://www.disneyplus.com`，path `^(?:/[a-z]{2}(?:-[a-z0-9]{2,4})?)?/(?:play|video)/(<UUID>)/?$`（UUID 小寫十六進位 8-4-4-4-12；大寫也接受、回傳時轉小寫）。`watchUrl` → `https://www.disneyplus.com/play/<id>`（不帶秒數）。`tabPatterns`：`https://www.disneyplus.com/*`（jumpTo 自己再用 parse 比對 id）。
- [x] Netflix 的 `parseWatchVideoId`／`watchUrl` 不改，由登錄表引用。
- [x] `watchLinkText` 用 `formatTime`；三種文字照 spec §3.2。
- [x] `trigger.ts`：用 `detectWatchPage(tab.url)` 判斷；徽章提示改成 `請重新整理這個 <label> 分頁後再按一次`（匯出一個 `reloadTitle(label)` 函式，`RELOAD_BADGE`、`DEFAULT_ACTION_TITLE` 不變）。非播放頁照舊開筆記本。
- [x] `jump.ts`：簽名 `jumpTo(note: Pick<Note, 'platform' | 'videoId' | 'timeMs'>, deps)`。`JumpDeps` 改為 `queryTabs(patterns)`、`focus`、`sendToTab`、`createTab(url): Promise<number | undefined>`（回新分頁 id）、`updateTabUrl`、`wait(ms)`。找分頁時要求「同平台＋同 videoId」。`linkKeepsTime === false` 的平台：開新分頁後、以及既有分頁跳秒失敗改導向之後，每 `SEEK_RETRY_MS = 1000` 毫秒送一次 `scenenote/seek`，回 `true` 就停，最多 `SEEK_RETRY_LIMIT = 30` 次；送訊息丟例外（內容腳本還沒載入）也算一次失敗、繼續重試；全部失敗只 `console.warn`，仍回 `'new'`／`'existing'`。
- [x] `background.ts`：接線改用新 deps；`isJumpMessage` 的 `platform` 可省略（省略＝`'netflix'`），不認得的值拒絕；`isRecentMessage` 同理。
- [x] `recent.ts`：`listRecent(platform, videoId, limit, deps)`，只取同平台＋同 videoId。
- [x] `group.ts`：以 `platform + videoId` 分組（Netflix 與 YouTube 同 id 字串也要分開）；`NoteGroup` 加 `platform`。
- [x] `view.ts`：空狀態文字、時間按鈕 title 照 spec §3.6；每組標題旁加平台名稱小標籤（樣式跟現有 chip／低解析度標籤一致，自己找現有 CSS 沿用）。
- [x] `jump-client.ts`：送出 `platform`。
- [x] `html.ts`、`markdown.ts`：連結用 `PLATFORM_INFO[note.platform].watchUrl`、文字用 `watchLinkText`。
- [x] `backup.ts`：`platform` 用 `isPlatform` 驗證；`image.source` 接受 `'frame'`。
- [x] `overlay.ts`：`playerApi` 文字改成「播放器介面讀不到，秒數改從影片讀」。
- [x] `wxt.config.ts`：`host_permissions` 加兩個網域；`description` 改成「看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得（支援 Netflix、YouTube、Disney+）」。
- [x] 新測試（至少）：`tests/platforms/registry.test.ts`、`tests/platforms/youtube/url.test.ts`、`tests/platforms/disney/url.test.ts`（含語系前綴、大寫 UUID、`/video/`、非播放頁、別的網域、`undefined`）；jump：Disney+ 新分頁重試直到成功、30 次都失敗、送訊息丟例外後成功、YouTube 不重試、找分頁時不同平台同 id 不算；trigger：YouTube／Disney+ 播放頁走記錄、首頁開筆記本、徽章文字含平台名；group：同 id 不同平台分兩組；匯出：三平台連結與文字；backup：接受 youtube／disney／frame，拒絕未知平台；recent：過濾平台。
- [x] Commit：`feat: platform registry and multi-platform notes, jump and exports`

## Task 2：內容腳本共用層

**Files:** `src/platforms/bridge-protocol.ts`（由 netflix 搬來）、`src/core/hide-ui.ts`（搬來）、`src/platforms/language-reactor.ts`（新，自 netflix/subtitle.ts 抽出）、`src/core/content-main.ts`（新）、`src/core/capture-controller.ts`、`src/core/quick-button.ts`、`src/platforms/types.ts`、`src/platforms/netflix/*`、`src/entrypoints/netflix.content.ts`，與對應測試（搬檔的測試跟著搬）。

- [x] 搬檔照 Shared Interfaces；Netflix 端改 import，行為不變。`hidePlayerUi(root, keep)`：Netflix 傳原本的 `'video, .player-timedtext, #lln-main-subs'`。
- [x] `askBridge` 取代 Netflix adapter 私有的 `ask`。
- [x] `content-main.ts`：把 `netflix.content.ts` 的 `main()` 內容搬進 `runContentScript`；`isToContent`、`seekAndPause`、訊息監聽、頁面按鈕、`scenenote/shortcut` 都在這裡。`loadRecent` 送 `{ type: 'scenenote/recent', platform, videoId, limit: 2 }`。`netflix.content.ts` 只剩 `defineContentScript({ matches, main() { runContentScript({ platform: 'netflix', adapter: createNetflixAdapter(document), isWatchPage: () => parseWatchVideoId(location.href) !== null }) } })`。
- [x] `capture-controller.ts`：deps 加 `platform: Platform`，存檔用它。選圖順序（spec §3.3）：分頁截圖裁切沒被擋 → `adapter.grabFrame?.()` 有 bytes 時轉 data URL，再用 `deps.cropAndCheck(dataUrl, { x: 0, y: 0, width, height }, 1)` 做黑畫面判斷，沒被擋就 `source: 'frame'`、`missing: null` → 進度條小圖 → 沒有圖。`useShortcutOnce` 只在最後的 `source` 是 `'trickplay'` 或 `'none'` 時加。
- [x] `quick-button.ts`：選項加 `anchor?: () => Element | null`。有 anchor 時：只有滑鼠事件的座標落在 anchor 的 `getBoundingClientRect()` 內才顯示；位置以 `position: fixed` 的 `right`／`bottom` inline style 對齊 anchor 右下角（內縮右 24 px、下 80 px）；`scroll` 事件（capture、passive）時收起。沒有 anchor 時完全照 v1。全螢幕時照舊放進 `fullscreenElement`。
- [x] 測試：controller 的 `'frame'` 路徑（成功、被判黑改用 trickplay、grabFrame 丟例外）、hint 規則、`platform` 寫進筆記；quick button anchor（座標在內顯示、在外不顯示、位置 style、scroll 收起、無 anchor 時行為不變）；content-main 的 recent 訊息帶 platform（若現有架構難測，至少測 `isToContent`）；搬過去的 bridge-protocol／hide-ui／language-reactor 測試照舊通過。
- [x] Commit：`refactor: share the content script, page bridge protocol and UI hiding across platforms`

## Task 3：YouTube 轉接層（可與 Task 4 平行）

**Files:** `src/platforms/youtube/{subtitle,page-bridge,adapter}.ts`、`src/entrypoints/youtube.content.ts`、`src/entrypoints/youtube-bridge.content.ts`、`tests/platforms/youtube/*`。

- [ ] 照 spec §2.1、§3.3「YouTube 轉接層」實作。播放器元素：`location` 是 `/shorts/` 用 `#shorts-player`，否則 `#movie_player`。
- [ ] page-bridge（main world）：`playback` → `{ videoId, timeMs, title, ad }`（`getVideoData().video_id` 與網址 id 不同時以播放器的為準但仍要非空；`ad` 來自 `classList.contains('ad-showing')`）；`pause`/`play`/`seek`（`seekTo(ms / 1000, true)`）；`frame` → canvas 畫 `<video>`（`videoWidth`×`videoHeight`）→ `toBlob('image/jpeg', 0.9)` → `Uint8Array`；畫不出來回 `null`。用 `Symbol.for('scenenote.page-bridge')` 防重複安裝（照 Netflix）。
- [ ] adapter：`getPlayback` 廣告中回 `null`；橋接沒回答時退回網址 id＋`<video>.currentTime`＋清理過的分頁標題（`missing: ['playerApi','title']`；標題清不出東西時用 `YouTube <id>`）。`pause`/`play`/`seek` 橋接失敗退回 `<video>`。`getVideoRect` 用該播放器裡的 `video.html5-main-video`，用 `contentRect`（同 Netflix）。`hidePlayerUi` 以播放器元素為 root（全螢幕時若 `fullscreenElement` 不包含播放器，就用 `fullscreenElement`），keep＝`'video, .ytp-caption-window-container, #lln-main-subs'`。`getTrickplayFrame` 回 `null`。`grabFrame` 走橋接 `frame`（逾時 3000 ms）。
- [ ] subtitle：spec §2.1 的結構；略過含 `svg` 的 `.caption-window`；每個 `.caption-visual-line` 取文字（`.ytp-caption-segment` 串接），行與行、視窗與視窗以單一空白相接並 trim；空的話用 `extractLanguageReactorSubtitle`。
- [ ] entrypoints：`matches: ['https://www.youtube.com/*']`；bridge 用 `world: 'MAIN'`、`runAt: 'document_idle'`；content 用 `runContentScript({ platform: 'youtube', …, quickButtonAnchor: 播放器元素 })`，`isWatchPage` 用 YouTube 的 `parseWatchVideoId(location.href) !== null`。
- [ ] 測試：字幕（單行、多行、兩個視窗、含 svg 的語言標籤視窗被略過、沒字幕、Language Reactor 退路）；橋接（假 `movie_player` 物件：playback、廣告、seek 秒數換算、shorts 用 `#shorts-player`、方法不存在時回 null/false）；adapter（橋接 mock：正常、廣告、退路、標題清理「(107) 片名 - YouTube」→「片名」、`<video>` 選擇在 shorts 頁有兩個 video 時選對）。
- [ ] Commit：`feat: YouTube adapter`

## Task 4：Disney+ 轉接層（可與 Task 3 平行）

**Files:** `src/platforms/disney/{subtitle,metadata,page-bridge,adapter}.ts`、`src/entrypoints/disney.content.ts`、`src/entrypoints/disney-bridge.content.ts`、`tests/platforms/disney/*`。

- [ ] 照 spec §2.2、§3.3「Disney+ 轉接層」實作。
- [ ] metadata：`parseDisneySubtitle(text) → { season?, episode?, episodeTitle? }`：支援「第 1 季第 2 集：集名」（空白、全形／半形冒號可有可無）、`S1:E2 集名`、`S1 E2`、`Season 1 Episode 2 集名`（不分大小寫，集名前可有 `:`、`-`、`·`）。標記字母隨語系不同（研究看到 `S2:E3`、`S2:O3`、`Ř22:D10`），所以「字母＋數字 `:` 字母＋數字」要用 Unicode 字母 `\p{L}{1,3}` 比對，不寫死 S／E。集名若是「第2集」「第 2 集」「Episode 2」「Ep. 2」這種只重複集數的字串就不回傳。空字串回 `{}`；解析不了回 `{ episodeTitle: text.trim() }`。
- [ ] page-bridge（main world）：取 `document.querySelector('disney-web-player')?.mediaPlayer`。`playback` → `{ videoId: 網址 UUID, timeMs: Math.round(timeline.info.playheadPositionMs), title: metadata.title.text, subtitle: metadata.subtitle.text, state: playbackStatus.currentState }`；播放器不存在或 `currentState === 'NOTREADY'` 回 `null`。`pause`/`play` 呼叫 mediaPlayer 方法（回傳值可能是 Promise，要 await，丟例外回 false）。`seek`：`NOTREADY` 時回 false；否則 `seek(ms)`，之後每 150 ms 讀一次 `playheadPositionMs`，1500 ms 內與目標差 < 3000 就回 true，否則 false。`trickplay`／`frame` 回 null。防重複安裝同 Netflix。
- [ ] adapter：`getPlayback`：橋接有回答 → title（空的話用分頁標題去掉「 | Disney+」，再不行 `Disney+ <id 前 8 碼>` 並 `missing: ['title']`）＋ `parseDisneySubtitle`。橋接沒回答 → 讀進度條 `aria-valuenow`（秒；要穿過 open shadow root 找 `.progress-bar__seekable-range`，也接受任何 `[role="slider"][aria-valuenow]` 在 `progress-bar` 自訂元素裡），有就回傳 `missing: ['playerApi', 'title']`（標題用分頁標題）；沒有就回 `null`。**任何情況都不讀 `<video>.currentTime`。** `pause`/`play`/`seek` 只走橋接（`seek` 逾時 2500 ms）。`getVideoRect`：`video.hive-video`（或第一個寬高 > 0 的 `<video>`）＋`contentRect`。`hidePlayerUi` root＝`fullscreenElement ?? body`，keep＝`'video, timed-text-override-region'`。`getTrickplayFrame`、`grabFrame` 不提供或回 `null`。
- [ ] subtitle：`timed-text-override-region` 的 `shadowRoot` 裡 `.hive-subtitle-renderer-line`；沒有再找整份文件（含 open shadow roots）的 `.dss-subtitle-renderer-line`；各行文字 trim 後以單一空白相接。
- [ ] entrypoints：`matches: ['https://www.disneyplus.com/*']`；content 不給 `quickButtonAnchor`；`isWatchPage` 用 Disney 的 parse。
- [ ] 測試：metadata 各格式與重複集名；字幕（shadow root 單行、多行、舊 class、沒字幕）；橋接（假 mediaPlayer：playback、NOTREADY、seek 成功／逾時、pause 回 Promise）；adapter（正常、title 退路、進度條退路、全都沒有回 null、不碰 `<video>.currentTime`——給一個 currentTime 很大的 video 驗證沒被用到；`getVideoRect` 選到 `hive-video` 而不是 0×0 那個）。
- [ ] Commit：`feat: Disney+ adapter`

## Task 5：文件

- [ ] README：標題敘述、安裝第 3 步（三個平台的分頁都要重新整理）、使用方式（三平台的播放頁網址）、已知限制（每個平台列出退路；YouTube 廣告中不記、Disney+ 連結不帶秒數、Disney+ 沒有低解析度備案、YouTube 頁面按鈕第一次用原畫面不含字幕）。
- [ ] `docs/acceptance-2026-10-29-youtube-disney.md`：真人驗收清單（重新載入擴充功能後；YouTube 一般／劇院／全螢幕／Shorts、開關字幕、頁面按鈕第一次用、跳回同分頁與新分頁；Disney+ 電影與影集、季集、開關字幕、跳回新分頁停在正確秒數、匯出連結文字；Netflix 回歸：記一則、跳回）。
- [ ] `TODO.md`：把「Disney+、YouTube 轉接層」移到完成，加上這版的待驗收與延後項目。
- [ ] v1 spec §2 範圍表加一句指向新 spec。
- [ ] Commit：`docs: YouTube and Disney+ support`
