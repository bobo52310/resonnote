# scenenote v1（Netflix）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出一個 Chrome 擴充功能：在 Netflix 播放頁按 ⌥⇧N 記下「畫面＋秒數＋台詞＋心得」，在筆記本頁面跳回那一秒、匯出 LINE 圖卡／網頁檔／Markdown、備份還原。

**Architecture:** WXT（MV3）。三層：`src/platforms/netflix/`（平台轉接層，含 main world bridge）、`src/core/`（截圖數學、資料庫、備份、小視窗、記錄流程）、`src/notebook/` 與 `src/export/`（筆記本頁面與匯出）。背景程式負責快捷鍵、`captureVisibleTab`、寫資料庫、跳轉分頁；內容腳本不碰資料庫。

**Tech Stack:** TypeScript、WXT、Vitest＋happy-dom＋fake-indexeddb、idb、fflate；pnpm。

**Spec:** `docs/superpowers/specs/2026-10-28-scenenote-design.md`（每個 task 都要對照它；本計畫只寫 spec 沒定下來的決定）

## Global Constraints

- 套件一律裝當下最新穩定版；TypeScript strict。
- 介面文字繁體中文；程式碼、識別字、commit message 英文。
- 權限只有：`permissions: ['activeTab', 'storage', 'unlimitedStorage']`、`host_permissions: ['https://www.netflix.com/*']`。不得新增。
- 快捷鍵 `Alt+Shift+N`（mac 同），command 名稱 `capture-scene`，描述「記下這一刻」。
- 截圖 JPEG quality 90（`captureVisibleTab`）與裁切後輸出 quality 0.9。
- 黑畫面判斷：區域 x 20%–80%、y 15%–60%；亮度 `0.2126R+0.7152G+0.0722B < 16` 的像素比例 `> 0.95` 即為被擋。
- Netflix 連結：`https://www.netflix.com/watch/<videoId>?t=<floor(timeMs/1000)>`；連結文字「在 Netflix 從 <formatTime> 開始看」。
- 圖卡寬 1080 px；網頁檔圖片縮到寬 ≤1280 px；備份 zip＝`notes.json`＋`images/<id>.jpg`；Markdown zip＝`notes.md`＋`images/<id>.jpg`。
- 備份提醒門檻：距上次備份 `> 14` 天或從未備份。
- console 訊息一律以 `[scenenote]` 開頭。
- 不得使用 `alert` / `confirm` / `prompt`（刪除確認用頁面內兩段式按鈕）。
- 平台轉接層的方法失敗時回傳 `null` / `false`，不丟例外。

## Review Focus

1. **中文輸入法選字的 Enter**（`isComposing === true`）不能觸發存檔——注音使用者每打幾個字就會按一次 Enter。→ Task 7 測試 `does not save on Enter while composing`。
2. **小視窗開著時又按一次快捷鍵**：不能再截一張、不能出現第二個小視窗。→ Task 8 測試 `begin returns busy while overlay is open`、`trigger skips capture when busy`。
3. **在非播放頁按快捷鍵**（Netflix 首頁、別的網站、`chrome://` 頁）：開筆記本，不報錯。→ Task 8 測試 `opens notebook for non-watch urls`（含 `undefined` url）。
4. **很長、沒有空白的中文心得或台詞**放進圖卡：要逐字換行、不超出寬度。→ Task 11 測試 `wraps 500 CJK chars within content width`。
5. **同一份備份還原兩次、或備份裡缺某張圖**：不能重複；缺圖的筆記照樣匯入（沒有圖）。→ Task 5 測試 `restoring the same backup twice does not duplicate`、`imports a note whose image is missing`。

## Execution Notes

- 每個 task：fresh implementer（sonnet）→ fresh verifier 對照該 task 的步驟與 spec 驗收。
- Task 8 結束時有一個**使用者檢查點**（載入擴充功能試記一則）；Task 12 由主對話帶使用者在真 Netflix 跑驗收清單。
- 不 push、不建 GitHub repo（等使用者決定）。

## File Map

```
wxt.config.ts                  manifest（含固定 key）、srcDir: 'src'
vitest.config.ts               WxtVitest + happy-dom + fake-indexeddb/auto
src/entrypoints/
  background.ts                接線：commands/action → trigger；runtime 訊息 → save/jump/open
  netflix.content.ts           isolated world：adapter + capture controller + overlay
  netflix-bridge.content.ts    world: 'MAIN'：installPageBridge()
  options/index.html, main.ts  筆記本頁面（open_in_tab）
src/core/
  types.ts  format.ts  capture-math.ts  crop.ts  db.ts  backup.ts
  messages.ts  capture-controller.ts  overlay/overlay.ts
src/platforms/
  types.ts
  netflix/ bif.ts metadata.ts subtitle.ts url.ts bridge-protocol.ts page-bridge.ts adapter.ts
src/background/ trigger.ts save.ts jump.ts
src/notebook/ group.ts view.ts
src/export/ markdown.ts html.ts card.ts image.ts download.ts
tests/                         與 src 同結構，檔名 *.test.ts
```

---

### Task 1: 專案骨架、manifest、共用型別與格式化

**Files:**
- Create: 專案骨架（`package.json`、`tsconfig.json`、`wxt.config.ts`、`vitest.config.ts`、`.gitignore`）、`src/core/types.ts`、`src/core/format.ts`
- Test: `tests/core/format.test.ts`

**Interfaces:**
- Produces（`src/core/types.ts`）：
  ```ts
  export type Platform = 'netflix';
  export type ImageSource = 'tab' | 'trickplay' | 'none';
  export type Missing = 'fullFrame' | 'image' | 'subtitle' | 'title' | 'playerApi';
  export interface Rect { x: number; y: number; width: number; height: number }
  export interface Playback {
    videoId: string; title: string; timeMs: number;
    season?: number; episode?: number; episodeTitle?: string;
  }
  export interface Note extends Playback {
    id: string; platform: Platform; subtitle: string; body: string;
    image: { source: ImageSource; width: number; height: number };
    createdAt: string; updatedAt: string;
  }
  ```
- Produces（`src/core/format.ts`）：`formatTime(ms: number): string`、`noteHeading(n: Pick<Note,'title'|'season'|'episode'|'episodeTitle'>): string`、`safeFileName(s: string): string`

- [ ] **Step 1: 建骨架**——WXT 官方 `init`（vanilla 範本、pnpm）產生在暫存資料夾再搬進 repo 根目錄（repo 已有 `docs/`）；刪掉範本的 popup／content 範例；`wxt.config.ts` 設 `srcDir: 'src'` 與 Global Constraints 的 manifest 欄位，外加 `action: { default_title: '記下這一刻（scenenote）' }`；`options` entrypoint 加 `<meta name="manifest.open_in_tab" content="true" />`，內容先放一行「scenenote 筆記本」。裝 `vitest happy-dom fake-indexeddb idb fflate`（latest）。`vitest.config.ts`：`plugins: [WxtVitest()]`、`environment: 'happy-dom'`、`setupFiles: ['fake-indexeddb/auto']`。`package.json` scripts 要有 `test`（`vitest run`）、`compile`（`tsc --noEmit`）、`build`。

- [ ] **Step 2: 固定擴充功能 ID**——產生一把 RSA 公鑰當 manifest `key`（私鑰不需保存）：
  ```bash
  openssl genrsa 2048 2>/dev/null | openssl rsa -pubout -outform DER 2>/dev/null | base64 | tr -d '\n'
  ```
  寫進 `wxt.config.ts` 的 `manifest.key`。用同一把 DER 算出 ID（SHA-256 前 32 個 hex 字元，0–f 對應 a–p），記在 `README.md` 的「擴充功能 ID」一行。

- [ ] **Step 3: 寫失敗測試** `tests/core/format.test.ts`
  ```ts
  expect(formatTime(1003469)).toBe('16:43');
  expect(formatTime(0)).toBe('0:00');
  expect(formatTime(3963000)).toBe('1:06:03');
  expect(noteHeading({ title: '造山者－世紀的賭注' })).toBe('造山者－世紀的賭注');
  expect(noteHeading({ title: '新手上路', season: 1, episode: 2, episodeTitle: 'B' })).toBe('新手上路 第1季第2集 B');
  expect(noteHeading({ title: '新手上路', season: 1, episode: 2 })).toBe('新手上路 第1季第2集');
  expect(safeFileName('a/b:c*?"<>|')).toBe('a_b_c______');
  expect(safeFileName('   ')).toBe('untitled');
  expect(safeFileName('字'.repeat(100))).toHaveLength(80);
  ```
- [ ] **Step 4:** `pnpm vitest run tests/core/format.test.ts` → FAIL（模組不存在）
- [ ] **Step 5: 實作 `format.ts`**——`formatTime` 無條件捨去到秒；`safeFileName` 把 `/\:*?"<>|` 換成 `_`、trim、截到 80 字、空字串回 `'untitled'`。
- [ ] **Step 6:** `pnpm vitest run tests/core/format.test.ts` → PASS；`pnpm compile` 無錯；`pnpm build` 後 `.output/chrome-mv3/manifest.json` 含 `key`、三個 permissions、一個 host permission、`commands.capture-scene`、`options_ui.open_in_tab: true`。
- [ ] **Step 7: Commit** `chore: scaffold WXT extension with fixed key and shared formatting`

---

### Task 2: 截圖數學（裁切範圍、黑畫面判斷）

**Files:** Create `src/core/capture-math.ts`；Test `tests/core/capture-math.test.ts`

**Interfaces:**
- Consumes: `Rect`（Task 1）
- Produces:
  - `contentRect(box: Rect, videoWidth: number, videoHeight: number): Rect`——object-fit: contain 的實際畫面範圍（CSS px）
  - `toDevicePx(rect: Rect, dpr: number, imageWidth: number, imageHeight: number): Rect`——乘 dpr、四捨五入、夾在圖片範圍內
  - `isBlockedFrame(img: { data: Uint8ClampedArray; width: number; height: number }): boolean`

- [ ] **Step 1: 失敗測試**
  ```ts
  // contentRect: 1440x748 容器放 1920x1080 影片 → 左右留黑
  const r = contentRect({ x: 0, y: 0, width: 1440, height: 748 }, 1920, 1080);
  expect(r.height).toBeCloseTo(748); expect(r.width).toBeCloseTo(1329.78, 1); expect(r.x).toBeCloseTo(55.11, 1); expect(r.y).toBe(0);
  // 直式容器 → 上下留黑
  const t = contentRect({ x: 0, y: 0, width: 1000, height: 1000 }, 1920, 1080);
  expect(t.width).toBe(1000); expect(t.y).toBeCloseTo(218.75);
  // toDevicePx
  expect(toDevicePx({ x: 55.11, y: 0, width: 1329.78, height: 748 }, 2, 2880, 1496)).toEqual({ x: 110, y: 0, width: 2660, height: 1496 });
  expect(toDevicePx({ x: -5, y: -5, width: 2000, height: 2000 }, 1, 100, 50)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  // isBlockedFrame（用 helper 造 100x100 圖）
  expect(isBlockedFrame(solid(100, 100, 0))).toBe(true);
  expect(isBlockedFrame(solid(100, 100, 128))).toBe(false);
  expect(isBlockedFrame(blackWithGrayBottom(100, 100, 0.7))).toBe(true); // 只有下方 30% 有字幕亮點
  ```
- [ ] **Step 2:** `pnpm vitest run tests/core/capture-math.test.ts` → FAIL
- [ ] **Step 3: 實作**（參數值見 Global Constraints）
- [ ] **Step 4:** 同指令 → PASS
- [ ] **Step 5: Commit** `feat: add crop geometry and blocked-frame detection`

---

### Task 3: BIF 解析

**Files:** Create `src/platforms/netflix/bif.ts`；Test `tests/platforms/netflix/bif.test.ts`

**Interfaces:**
- Produces:
  - `interface BifIndex { count: number; intervalMs: number; offsets: number[] }`（`offsets.length === count + 1`）
  - `parseBif(buf: ArrayBuffer): BifIndex | null`——檔頭不是 `89 42 49 46 0d 0a 1a 0a` 回 `null`；offset 12 張數、offset 16 間隔（0 視為 1000）、offset 64 起 `count + 1` 筆 `(uint32 frameNo, uint32 offset)`，全部 little-endian
  - `bifFrame(buf: ArrayBuffer, index: BifIndex, timeMs: number): Uint8Array`——`i = clamp(floor(timeMs / intervalMs), 0, count - 1)`，回傳 `[offsets[i], offsets[i+1])`

- [ ] **Step 1: 失敗測試**——測試檔內寫 `makeBif(frames: Uint8Array[], intervalMs: number): ArrayBuffer`（依上面格式組，最後一筆 frameNo 為 `0xffffffff`）。
  ```ts
  const buf = makeBif([u8(1,1), u8(2,2,2), u8(3)], 10000);
  const idx = parseBif(buf)!;
  expect(idx.count).toBe(3); expect(idx.intervalMs).toBe(10000);
  expect([...bifFrame(buf, idx, 0)]).toEqual([1,1]);
  expect([...bifFrame(buf, idx, 25000)]).toEqual([3]);
  expect([...bifFrame(buf, idx, 999999)]).toEqual([3]);   // 超出 → 最後一張
  expect([...bifFrame(buf, idx, -5)]).toEqual([1,1]);
  expect(parseBif(new ArrayBuffer(80))).toBeNull();
  ```
- [ ] **Step 2:** `pnpm vitest run tests/platforms/netflix/bif.test.ts` → FAIL
- [ ] **Step 3: 實作**
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat: parse Netflix BIF trickplay files`

---

### Task 4: 資料庫

**Files:** Create `src/core/db.ts`；Test `tests/core/db.test.ts`

**Interfaces:**
- Consumes: `Note`
- Produces（DB 名 `scenenote`、version 1；store `notes` keyPath `id`；store `images` 以 note id 為 key、值為 `ArrayBuffer`）：
  `putNote(n: Note): Promise<void>`、`getNote(id: string): Promise<Note | undefined>`、`listNotes(): Promise<Note[]>`、`deleteNote(id: string): Promise<void>`（同時刪圖）、`putImage(id: string, bytes: ArrayBuffer): Promise<void>`、`getImage(id: string): Promise<ArrayBuffer | undefined>`、`closeDb(): Promise<void>`（測試用，關掉快取的連線）

- [ ] **Step 1: 失敗測試**——`beforeEach`：`await closeDb(); globalThis.indexedDB = new IDBFactory();`（from `fake-indexeddb`）。測：存取來回一致；`listNotes` 回全部；`deleteNote` 後 `getImage` 為 `undefined`；`putImage` 存 `[1,2,3]` 取回位元組相同。
- [ ] **Step 2:** `pnpm vitest run tests/core/db.test.ts` → FAIL
- [ ] **Step 3: 實作**（用 `idb` 的 `openDB`，連線 promise 快取在模組內）
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat: add IndexedDB storage for notes and images`

---

### Task 5: 備份與還原

**Files:** Create `src/core/backup.ts`；Test `tests/core/backup.test.ts`

**Interfaces:**
- Consumes: `Note`、Task 4 的 db 函式
- Produces:
  - `createBackupZip(notes: Note[], images: Map<string, Uint8Array>): Uint8Array`（`notes.json` 為 `{ version: 1, notes }`）
  - `class BackupFormatError extends Error`
  - `parseBackupZip(data: Uint8Array): { notes: Note[]; images: Map<string, Uint8Array> }`——沒有 `notes.json` 或格式不對丟 `BackupFormatError`
  - `mergeNotes(existing: Note[], incoming: Note[]): Note[]`——回傳「要寫入的」筆記：新 id，或同 id 且 `incoming.updatedAt > existing.updatedAt`
  - `restoreBackup(data: Uint8Array): Promise<{ written: number; skipped: number }>`——用 db 寫入；有圖才寫圖
  - `exportAllBackup(): Promise<Uint8Array>`——從 db 讀全部組 zip
  - `getLastBackupAt(): Promise<string | null>`、`setLastBackupAt(iso: string): Promise<void>`（`browser.storage.local`，key `lastBackupAt`）
  - `needsBackupReminder(lastIso: string | null, now: Date): boolean`（`null` 或 `> 14` 天為 true）

- [ ] **Step 1: 失敗測試**
  - zip 來回：`parseBackupZip(createBackupZip(notes, imgs))` 的 notes 與圖位元組相同
  - `parseBackupZip(zipWith({ 'x.txt': … }))` 丟 `BackupFormatError`
  - `mergeNotes`：同 id 舊的不寫、新的寫、新 id 寫
  - `restoring the same backup twice does not duplicate`：還原兩次後 `listNotes()` 長度不變，第二次 `written === 0`
  - `imports a note whose image is missing`：zip 裡少一張圖 → 筆記仍寫入、`getImage` 為 `undefined`
  - `needsBackupReminder(null, now)` true；13 天前 false；15 天前 true
- [ ] **Step 2:** `pnpm vitest run tests/core/backup.test.ts` → FAIL
- [ ] **Step 3: 實作**（fflate `zipSync` / `unzipSync`）
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat: add zip backup and restore with newest-wins merge`

---

### Task 6: Netflix 平台轉接層

**Files:**
- Create: `src/platforms/types.ts`、`src/platforms/netflix/{subtitle,metadata,url,bridge-protocol,page-bridge,adapter}.ts`、`src/entrypoints/netflix-bridge.content.ts`
- Test: `tests/platforms/netflix/{subtitle,metadata,url,bridge,adapter}.test.ts`

**Interfaces:**
- Consumes: `Playback`、`Rect`、Task 2 `contentRect`、Task 3 `parseBif` / `bifFrame`
- Produces（`src/platforms/types.ts`）：
  ```ts
  export interface PlatformAdapter {
    // missing：用了退路就標 'playerApi'；片名退到分頁標題或編號就標 'title'
    getPlayback(): Promise<{ playback: Playback; missing: Missing[] } | null>;
    getSubtitleText(): string;                 // 沒有就 ''
    pause(): Promise<boolean>; play(): Promise<boolean>; seek(timeMs: number): Promise<boolean>;
    getVideoRect(): Rect | null;               // CSS px，已套 contentRect
    getTrickplayFrame(timeMs: number): Promise<Uint8Array | null>; // JPEG 位元組
    watchUrl(videoId: string, timeMs: number): string;
  }
  ```
- Produces（netflix）：
  - `cleanLanguageReactorText(raw: string): string`、`extractSubtitle(doc: Document): string`
  - `mapNetflixMetadata(video: unknown, movieId: number): Pick<Playback,'title'|'season'|'episode'|'episodeTitle'> | null`
  - `watchUrl(videoId: string, timeMs: number): string`、`parseWatchVideoId(url: string | undefined): string | null`（只認 `https://www.netflix.com/watch/<數字>`）
  - bridge 協定：請求 `{ source: 'scenenote-req', id: string, op: 'playback' | 'pause' | 'play' | 'seek' | 'trickplay', timeMs?: number }`，回應 `{ source: 'scenenote-res', id, result }`；`callBridge<T>(op, timeMs?, timeoutMs = 1000): Promise<T | null>`（逾時回 `null`）
  - `installPageBridge(win: Window): void`（main world）：`playback` 回 `{ videoId: string, timeMs: number, meta }`；`trickplay` 回 JPEG `Uint8Array` 或 `null`
  - `createNetflixAdapter(doc: Document): PlatformAdapter`

**Decisions（spec §3、§4 已實測的值）：**
- player 取得：`netflix.appContext.state.playerApp.getAPI().videoPlayer` → `getVideoPlayerBySessionId(getAllPlayerSessionIds().at(-1))`
- metadata：`getState().videoPlayer.videoMetadata[movieId]._metadata.video`
- trickplay：先 `player.getTrickPlayFrame(timeMs)?.image`，首兩個位元組要是 `FF D8`；否則從 `performance.getEntriesByType('resource')` 找網址符合 `/\.bif(\?|$)/` 的最後一筆，`fetch` 一次並依 URL 快取 `ArrayBuffer`，用 `bifFrame`
- adapter 退路（bridge 回 `null` 時）：`getPlayback` 改用 `parseWatchVideoId(location.href)`＋`<video>.currentTime*1000`，title 用 `document.title`（若等於 `Netflix` 則用 `Netflix <videoId>`）；`pause` / `play` 改用 `<video>`；`seek` 回 `false`
- 每次呼叫當下才讀（不在初始化時快取播放資訊）——Netflix 是單頁應用，換片不會重載內容腳本
- `netflix-bridge.content.ts`：`matches: ['https://www.netflix.com/*']`、`world: 'MAIN'`、`runAt: 'document_idle'`，`main()` 只呼叫 `installPageBridge(window)`

- [ ] **Step 1: 失敗測試**
  ```ts
  // subtitle
  expect(cleanLanguageReactorText('... 而 ... 二 樓 ... 則 ... 是 ... 蔣 經 國 ... 先 生 ... 和 ... 政 府 ... 高 層'))
    .toBe('而二樓則是蔣經國先生和政府高層');
  expect(cleanLanguageReactorText("I ... don't ... know ...")).toBe("I don't know");
  expect(cleanLanguageReactorText('我 用 iPhone 拍')).toBe('我用 iPhone 拍');
  // extractSubtitle：三個 fixture
  //  a) .player-timedtext 有字 → 該文字（空白收斂）
  //  b) .player-timedtext 空＋#lln-main-subs .lln-subs-text 內含 span.translit 拼音 → 去拼音後的中文
  //  c) 兩者都沒有 → ''
  // metadata
  expect(mapNetflixMetadata({ type: 'movie', title: '造山者－世紀的賭注', id: 83053998 }, 83053998)).toEqual({ title: '造山者－世紀的賭注' });
  expect(mapNetflixMetadata(showFixture, 112)).toEqual({ title: '新手上路', season: 1, episode: 2, episodeTitle: 'B' });
  expect(mapNetflixMetadata(showFixture, 999)).toEqual({ title: '新手上路' });
  expect(mapNetflixMetadata(undefined, 1)).toBeNull();
  // url
  expect(watchUrl('83053998', 1003469)).toBe('https://www.netflix.com/watch/83053998?t=1003');
  expect(parseWatchVideoId('https://www.netflix.com/watch/83053998?t=5')).toBe('83053998');
  expect(parseWatchVideoId('https://www.netflix.com/browse')).toBeNull();
  expect(parseWatchVideoId(undefined)).toBeNull();
  // bridge（happy-dom window＋假的 netflix 全域物件）
  //  - playback 回 { videoId: '83053998', timeMs: 1003469, meta: { title: … } }
  //  - trickplay：假 player 給 FF D8 開頭 → 原樣回傳；給 00 00 → 走 BIF（假 performance entry＋假 fetch）回 BIF 那張
  //  - 沒裝 bridge 時 callBridge 在 timeout 後回 null
  // adapter
  //  - bridge 回 null → getPlayback 用網址＋video.currentTime（例：currentTime 12.5 → timeMs 12500），missing 含 'playerApi' 與 'title'
  //  - bridge 正常 → missing 為 []
  //  - getVideoRect 用 video 的 getBoundingClientRect＋videoWidth/Height 套 contentRect
  ```
- [ ] **Step 2:** `pnpm vitest run tests/platforms/netflix` → FAIL
- [ ] **Step 3: 實作各檔**（`cleanLanguageReactorText` 演算法：以空白切 token、去掉每個 token 頭尾的 `...`／`…`、丟掉空 token；相鄰兩 token 若前者最後一字與後者第一字都是中日韓字元〔`　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯`〕就直接相連，否則以一個空白相連）
- [ ] **Step 4:** `pnpm vitest run tests/platforms/netflix` → PASS；`pnpm compile` 無錯
- [ ] **Step 5: Commit** `feat: add Netflix adapter with main-world player bridge`

---

### Task 7: 播放器上的小視窗

**Files:** Create `src/core/overlay/overlay.ts`（樣式以字串注入 Shadow DOM）；Test `tests/core/overlay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // Missing 型別來自 src/core/types.ts（Task 1）
  export const MISSING_LABELS: Record<Missing, string> = {
    fullFrame: '完整畫面截不到，改用進度條小圖',
    image: '沒有截到圖',
    subtitle: '沒抓到台詞',
    title: '沒抓到片名',
    playerApi: 'Netflix 播放器介面讀不到，秒數改從影片讀',
  };
  export type OverlayResult = { action: 'save'; subtitle: string; body: string } | { action: 'cancel' };
  export interface OverlayHandle {
    result: Promise<OverlayResult>;  // 只 resolve 一次
    showError(message: string): void; // 不關閉、保留文字，之後還能再按 Enter 存
    reopenResult(): Promise<OverlayResult>; // showError 之後等下一次 save/cancel
    close(): void;
    isOpen(): boolean;
  }
  export function openOverlay(opts: {
    mount: Element; thumbUrl: string | null; heading: string; time: string;
    subtitle: string; missing: Missing[]; onOpenNotebook: () => void;
  }): OverlayHandle;
  ```
- 版面依 spec §4.5；另有一個「開啟筆記本」文字連結呼叫 `onOpenNotebook`。

- [ ] **Step 1: 失敗測試**（happy-dom）
  - 顯示 heading、time、subtitle（可編輯）與每個 `missing` 的中文標籤
  - 在心得框按 Enter → `result` 為 `{ action: 'save', subtitle, body }`
  - `does not save on Enter while composing`：`new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })` → `result` 未 resolve
  - Shift+Enter → 未 resolve
  - Esc → `{ action: 'cancel' }`
  - 在小視窗內的 keydown 不會冒泡到 `document` 上的監聽器（例：空白鍵、`f`）
  - `showError('存檔失敗：x')` 後小視窗仍開著、文字還在、`reopenResult()` 在下一次 Enter 時 resolve
- [ ] **Step 2:** `pnpm vitest run tests/core/overlay.test.ts` → FAIL
- [ ] **Step 3: 實作**
- [ ] **Step 4:** → PASS
- [ ] **Step 5: Commit** `feat: add in-player note overlay`

---

### Task 8: 記錄流程串起來（內容腳本＋背景程式）

**Files:**
- Create: `src/core/messages.ts`、`src/core/crop.ts`、`src/core/capture-controller.ts`、`src/background/trigger.ts`、`src/background/save.ts`、`src/entrypoints/netflix.content.ts`、`src/entrypoints/background.ts`
- Test: `tests/core/capture-controller.test.ts`、`tests/background/trigger.test.ts`、`tests/background/save.test.ts`

**Interfaces:**
- Consumes: Task 2、4、6、7 的全部 Produces
- Produces（`messages.ts`）：
  ```ts
  export type BeginResult = { status: 'ok' } | { status: 'busy' } | { status: 'no-video' };
  export type ToContent =
    | { type: 'scenenote/begin' }
    | { type: 'scenenote/show'; dataUrl: string | null }
    | { type: 'scenenote/seek'; timeMs: number };
  export type ToBackground =
    | { type: 'scenenote/save'; note: Note; imageDataUrl: string | null }
    | { type: 'scenenote/open-notebook' };
  export type SaveResult = { ok: true } | { ok: false; error: string };
  ```
- `crop.ts`（僅瀏覽器，無單元測試）：`cropAndCheck(dataUrl: string, cssRect: Rect, dpr: number): Promise<{ dataUrl: string; width: number; height: number; blocked: boolean }>`——`createImageBitmap` 解碼後用 `toDevicePx(cssRect, dpr, bitmap.width, bitmap.height)` 算範圍、`OffscreenCanvas` 裁切、輸出 JPEG 0.9、在裁切後的圖上跑 `isBlockedFrame`；`jpegBytesToDataUrl` 也放這個檔
- `capture-controller.ts`：
  ```ts
  export function createCaptureController(deps: {
    adapter: PlatformAdapter;
    cropAndCheck: typeof cropAndCheck;
    jpegBytesToDataUrl: (bytes: Uint8Array) => Promise<{ dataUrl: string; width: number; height: number }>;
    openOverlay: typeof openOverlay;
    sendToBackground: (msg: ToBackground) => Promise<SaveResult | void>;
    mount: () => Element;          // document.fullscreenElement ?? document.body
    dpr: () => number;
    now: () => Date; uuid: () => string;
  }): { begin(): Promise<BeginResult>; show(dataUrl: string | null): Promise<void> };
  ```
  `begin`：小視窗開著 → `busy`；`getPlayback()` 為 null → `no-video`；否則記下 playback 與其 missing、`getSubtitleText()`（空字串時 missing 加 `subtitle`）、`getVideoRect()`。`show`：先 `pause()`，再依序決定圖（`dataUrl` 與 rect 都有且完整截圖未被擋 → `tab`；否則 trickplay → `trickplay`＋missing `fullFrame`；都沒有 → `none`、寬高 0＋missing `image`），開小視窗（heading 用 `noteHeading`、time 用 `formatTime`）；save → 送 `scenenote/save`，`ok` 就 `close()`＋`play()`，失敗就 `showError('存檔失敗：' + error)` 並等 `reopenResult()`；cancel → `close()`＋`play()`。
- `trigger.ts`：
  ```ts
  export async function handleTrigger(tab: { id?: number; windowId: number; url?: string }, deps: {
    sendToTab: (tabId: number, msg: ToContent) => Promise<unknown>;
    captureVisibleTab: (windowId: number) => Promise<string>;   // jpeg quality 90
    openNotebook: () => Promise<void>;
  }): Promise<'notebook' | 'busy' | 'no-video' | 'shown'>;
  ```
  `parseWatchVideoId(tab.url)` 為 null 或沒有 `tab.id` → `openNotebook()`；否則 `begin` → 非 `ok` 就停；`captureVisibleTab` 丟例外時以 `null` 繼續；送 `show`。
- `save.ts`：`handleSave(msg: Extract<ToBackground, { type: 'scenenote/save' }>): Promise<SaveResult>`——`putNote`＋（有圖時）把 data URL 轉 `ArrayBuffer` 後 `putImage`；例外轉成 `{ ok: false, error }`
- `background.ts` 接線：`commands.onCommand('capture-scene')` 與 `action.onClicked` 都呼叫 `handleTrigger`；`runtime.onMessage` 處理 `save` 與 `open-notebook`（`runtime.openOptionsPage()`）；`seek` 的處理留給 Task 9。
- `netflix.content.ts`：`matches: ['https://www.netflix.com/*']`；建 adapter 與 controller，處理 `begin` / `show` / `seek`（`seek` → `adapter.seek` 後 `adapter.pause`）。

- [ ] **Step 1: 失敗測試**
  - controller：`begin returns busy while overlay is open`；`no-video`；未被擋 → 送出的 note `image.source === 'tab'`；被擋 → `trickplay` 且 missing 含 `fullFrame`；被擋且 trickplay 為 null → `none` 且 missing 含 `image`；`dataUrl` 為 null 走被擋路線；存檔失敗 → `showError` 被呼叫、`play` 沒被呼叫；成功 → `play` 被呼叫一次；cancel → 沒送 save、`play` 被呼叫
  - trigger：`opens notebook for non-watch urls`（`https://www.netflix.com/browse`、`https://example.com`、`undefined`）；`trigger skips capture when busy`（begin 回 busy → `captureVisibleTab` 沒被呼叫）；`captureVisibleTab` 丟例外 → 仍送 `show` 且 `dataUrl === null`；正常 → 回 `'shown'`，且 `begin` 在 `captureVisibleTab` 之前
  - save：寫入後 `getNote` / `getImage` 取得到；`imageDataUrl: null` 不寫圖；db 丟例外 → `{ ok: false }`
- [ ] **Step 2:** `pnpm vitest run tests/core/capture-controller.test.ts tests/background` → FAIL
- [ ] **Step 3: 實作並接線**
- [ ] **Step 4:** 測試 PASS；`pnpm compile`、`pnpm build` 無錯
- [ ] **Step 5: Commit** `feat: wire capture flow from shortcut to saved note`
- [ ] **Step 6: 使用者檢查點（主對話執行）**——請使用者在 `chrome://extensions` 載入 `.output/chrome-mv3`，在 Netflix 按 ⌥⇧N 記一則；確認小視窗出現、Enter 後影片繼續。有問題先修再往下。

---

### Task 9: 筆記本頁面（列表、編輯、刪除、跳回、備份）

**Files:**
- Create: `src/notebook/group.ts`、`src/notebook/view.ts`、`src/background/jump.ts`；Modify: `src/entrypoints/options/{index.html,main.ts}`、`src/entrypoints/background.ts`
- Test: `tests/notebook/group.test.ts`、`tests/background/jump.test.ts`、`tests/notebook/view.test.ts`

**Interfaces:**
- Consumes: db、backup、`watchUrl`、`formatTime`、`noteHeading`
- Produces:
  - `interface NoteGroup { videoId: string; heading: string; notes: Note[] }`；`groupNotes(notes: Note[]): NoteGroup[]`——依 `videoId` 分組；組依組內最新 `createdAt` 由新到舊；組內依 `timeMs` 由小到大
  - `jumpTo(note: Pick<Note,'videoId'|'timeMs'>, deps: { queryNetflixTabs(): Promise<{ id: number; windowId: number; url?: string }[]>; focus(tabId: number, windowId: number): Promise<void>; sendToTab(tabId: number, msg: ToContent): Promise<unknown>; createTab(url: string): Promise<void> }): Promise<'existing' | 'new'>`
  - runtime 訊息新增 `{ type: 'scenenote/jump'; videoId: string; timeMs: number }`（加進 `ToBackground`）
  - `renderNotebook(root: HTMLElement, deps: { listNotes: typeof listNotes; putNote: typeof putNote; deleteNote: typeof deleteNote; getImage: typeof getImage; jump: (note: Note) => void; now: () => Date }): Promise<void>`（備份相關直接 import Task 5 的函式）
  - `getSelectedNotes(root: HTMLElement): Note[]`——給 Task 10、11 的匯出按鈕用
- 頁面內容：頂部「上次備份：X 天前」（`needsBackupReminder` 為 true 時加醒目樣式；從未備份顯示「還沒備份過」）、「全部備份」「從備份還原」按鈕；每組標題＋「全選」；每則：勾選框、縮圖（沒圖顯示灰底「沒有圖」）、時間（點了跳回）、台詞、心得（`textarea`，blur 時若有變就 `putNote` 並更新 `updatedAt`）、刪除（第一次按變成「確定刪除？」，3 秒內再按才刪）。
- 備份檔名 `scenenote-backup-YYYYMMDD.zip`，存好後 `setLastBackupAt`。

- [ ] **Step 1: 失敗測試**——`groupNotes` 排序規則；`jumpTo` 有同片分頁 → `focus`＋送 `seek`、回 `'existing'`；沒有 → `createTab(watchUrl(...))`、回 `'new'`；`view`：改心得後 blur → `putNote` 收到新 body 且 `updatedAt` 變新；刪除要按兩次才呼叫 `deleteNote`；從未備份顯示「還沒備份過」
- [ ] **Step 2:** `pnpm vitest run tests/notebook tests/background/jump.test.ts` → FAIL
- [ ] **Step 3: 實作並接線**（`queryNetflixTabs` 用 `tabs.query({ url: 'https://www.netflix.com/watch/*' })`；同片判斷用 `parseWatchVideoId(tab.url) === videoId`）
- [ ] **Step 4:** PASS；`pnpm compile`、`pnpm build` 無錯
- [ ] **Step 5: Commit** `feat: add notebook page with jump-back and backup`

---

### Task 10: 匯出 Markdown 與網頁檔

**Files:** Create `src/export/markdown.ts`、`src/export/html.ts`、`src/export/image.ts`、`src/export/download.ts`；Modify `src/notebook/view.ts`；Test `tests/export/markdown.test.ts`、`tests/export/html.test.ts`

**Interfaces:**
- Consumes: `Note`、`formatTime`、`noteHeading`、`watchUrl`、`safeFileName`、`getSelectedNotes`
- Produces:
  - `buildMarkdown(notes: Note[], hasImage: (id: string) => boolean): string`
  - `buildMarkdownZip(notes: Note[], images: Map<string, Uint8Array>): Uint8Array`
  - `buildHtml(title: string, notes: Note[], imageDataUrls: Map<string, string>): string`
  - `downscaleJpeg(bytes: ArrayBuffer, maxWidth: number): Promise<string>`（`image.ts`，僅瀏覽器；寬度本來就 ≤ maxWidth 時不放大）
  - `downloadBytes(name: string, data: Uint8Array | string, mime: string): void`（`download.ts`，用 `<a download>`）
- Markdown 格式（依 `noteHeading` 分組，組內依 `timeMs`）：
  ```md
  # 造山者－世紀的賭注

  ## 16:43

  ![16:43](images/<id>.jpg)

  > 這通電話 為台灣走向科技之路開了一扇窗

  心得文字

  [在 Netflix 從 16:43 開始看](https://www.netflix.com/watch/83053998?t=1003)
  ```
  沒圖省略圖片行、沒台詞省略引用行、沒心得省略心得行；各區塊間一個空行；檔尾一個換行。
- HTML：`<html lang="zh-TW">`、有 `<meta name="viewport" content="width=device-width, initial-scale=1">`、CSS 內嵌、每則一個 `<article>`（圖、時間、台詞、心得、Netflix 連結），所有使用者文字都要跳脫。
- 筆記本加兩個按鈕「匯出網頁檔」「匯出 Markdown」（作用在勾選的筆記；沒勾就提示「先勾選要匯出的筆記」）；檔名 `safeFileName(noteHeading(第一則))` 加 `.html` 或 `-notes.zip`；網頁檔的圖用 `downscaleJpeg(…, 1280)`。

- [ ] **Step 1: 失敗測試**——一則筆記的 `buildMarkdown` 輸出完全等於上面的範例；沒圖／沒台詞／沒心得各省略對應行；zip 內有 `notes.md` 與 `images/<id>.jpg`、沒圖的筆記不放圖；HTML 含 viewport、`lang="zh-TW"`、`<article` 數量等於筆記數、心得 `<script>x</script>` 被跳脫、含 `data:image/jpeg` 與 Netflix 連結、沒圖的筆記沒有 `<img`
- [ ] **Step 2:** `pnpm vitest run tests/export` → FAIL
- [ ] **Step 3: 實作並接上按鈕**
- [ ] **Step 4:** PASS；`pnpm compile`、`pnpm build` 無錯
- [ ] **Step 5: Commit** `feat: export notes as Markdown zip and single-file HTML`

---

### Task 11: LINE 圖卡

**Files:** Create `src/export/card.ts`；Modify `src/notebook/view.ts`；Test `tests/export/card.test.ts`

**Interfaces:**
- Consumes: `noteHeading`、`formatTime`、`downloadBytes`、`getSelectedNotes`
- Produces:
  ```ts
  export interface CardInput { imageWidth: number; imageHeight: number; heading: string; time: string; subtitle: string; body: string }
  export interface CardBlock { font: string; color: string; lines: string[]; x: number; y: number; lineHeight: number }
  export interface CardLayout { width: 1080; height: number; image: Rect | null; blocks: CardBlock[] }
  export function layoutCard(input: CardInput, measure: (text: string, font: string) => number): CardLayout;
  export function renderCard(layout: CardLayout, image: ImageBitmap | null): Promise<Blob>; // PNG，僅瀏覽器
  ```
- 版面值：外距 48、內容寬 984；圖等比縮到寬 984（`imageWidth === 0` 時 `image: null`）；區塊間距 32；字型 `-apple-system, "PingFang TC", sans-serif`——標題 `bold 36px`（`heading · time`）、台詞 `40px`（前後加「「」」）、心得 `34px`；行高 = 字級 × 1.5；底色 `#ffffff`、主字 `#111111`、台詞 `#333333`。
- 換行：中日韓字元逐字可斷、其他以空白為單位斷；一個英文字比整行寬時硬斷；`\n` 強制換行。
- 筆記本加「複製圖卡」（只在勾選一則時可按；`navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`，成功顯示「已複製，可以貼到 LINE」）與「下載圖卡」（勾幾則下載幾張，檔名 `safeFileName(heading)-<formatTime 的冒號換成 ->.png`）。

- [ ] **Step 1: 失敗測試**（`measure` 用假函式：中日韓字元 = 字級、其他 = 字級 × 0.5）
  - `layout.width === 1080`；1920×1080 的圖 → `image` 寬 984、高 553.5
  - `wraps 500 CJK chars within content width`：每行 `measure(line, font) <= 984`，且行數 > 1
  - 台詞與心得都空 → `blocks` 只剩標題、`height` 比有內容時小
  - `imageWidth === 0` → `image === null`
  - `'a\nb'` 產生兩行
- [ ] **Step 2:** `pnpm vitest run tests/export/card.test.ts` → FAIL
- [ ] **Step 3: 實作並接上按鈕**
- [ ] **Step 4:** PASS；`pnpm compile`、`pnpm build` 無錯
- [ ] **Step 5: Commit** `feat: export LINE-ready note cards`

---

### Task 12: 實機驗收與 README（主對話＋使用者）

**Files:** Create/Modify `README.md`

- [ ] **Step 1:** `pnpm test`、`pnpm compile`、`pnpm build` 全過，貼輸出末段。
- [ ] **Step 2: README**——一句話介紹、安裝（`pnpm install && pnpm build`、`chrome://extensions` 載入 `.output/chrome-mv3`）、擴充功能 ID、快捷鍵、備份提醒（移除擴充功能會刪筆記）、已知限制（只在 macOS Chrome 實測；Netflix 改版的退路見 spec §8）。
- [ ] **Step 3: 實機驗收**——照 spec §9 的 13 項逐條跑；需要真人的（載入、按快捷鍵、全螢幕、中文輸入法、LINE 手機版、搬資料夾）列清單請使用者做；其餘用 Claude in Chrome 檢查。每項記「通過／不通過＋證據」寫進 `docs/acceptance-2026-10-28.md`。
- [ ] **Step 4:** 第 3 項（影集季、集）若不通過：依實際 metadata 結構修 `mapNetflixMetadata` 與其測試後重驗。
- [ ] **Step 5: Commit** `docs: add README and v1 acceptance results`
