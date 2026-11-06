# ResonNote 共鳴筆記

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) · [產品網站](https://resonnote.bobochen.dev)

看劇有共鳴的那一秒，一鍵記下畫面、秒數、台詞與心得的 Chrome 擴充功能（支援 Netflix、YouTube、Disney+）。

> 這一秒打動你，就把它留下來。

[![ResonNote 介紹影片（到產品網站觀看）](website/public/media/intro-poster.webp)](https://resonnote.bobochen.dev)

## 安裝

### 下載安裝（推薦）

不需要 Node.js，也不用自己 build。

1. 到 [Releases 頁面](https://github.com/bobo52310/resonnote/releases/latest) 下載 `resonnote-<版本>-chrome.zip`。
2. 解壓縮到一個之後不會刪掉的資料夾（Chrome 會直接從這個資料夾載入擴充功能）。
3. 開 `chrome://extensions`，右上角打開「開發人員模式」，按「載入未封裝項目」，選剛剛解壓縮的資料夾。
4. 已經開著的 Netflix、YouTube、Disney+ 分頁要各重新整理一次，細節見下面「從原始碼安裝」的第 3 點（兩種安裝方式都一樣）。

之後更新：下載新版 zip，用新版內容取代資料夾裡的檔案，再到 `chrome://extensions` 按 ResonNote 的重新載入。擴充功能 ID 是固定的，筆記會保留。

### 從原始碼安裝

需要 Node.js 22.12 以上（或 24）和 [pnpm](https://pnpm.io/)。

```sh
git clone https://github.com/bobo52310/resonnote.git
cd resonnote
pnpm install
pnpm build
```

1. 開 `chrome://extensions`，右上角打開「開發人員模式」。
2. 按「載入未封裝項目」，選專案資料夾底下的 `.output/chrome-mv3`。
3. 載入或重新載入擴充功能之後，已經開著的 Netflix、YouTube、Disney+ 分頁都要各重新整理一次（內容腳本不會自動注入舊分頁）。沒重新整理就按快捷鍵或工具列圖示，頁面上不會有任何反應，但那個分頁的工具列圖示會出現 `!` 徽章，滑鼠停上去會顯示「請重新整理這個 YouTube 分頁後再按一次」（Netflix、Disney+ 分頁則是各自的名稱）；重新整理分頁後徽章會消失（最晚在下一次按鍵成功時清掉）。擴充功能更新或重新載入後，舊分頁上還留著的「記下這一刻」按鈕點下去會改顯示「ResonNote 已更新，請重新整理這個分頁」。
4. 從只支援 Netflix 的舊版升級：新版多了 `www.youtube.com`、`www.disneyplus.com` 兩個網站權限，要在 `chrome://extensions` 按 ResonNote 的重新載入，新的 manifest 才會生效，這兩個網站才會注入內容腳本。重新載入後點「詳細資料」，「網站存取」應該有 Netflix、YouTube、Disney+ 三個網站。

## 使用方式

快捷鍵是 `⌥⇧N`，可以到 `chrome://extensions/shortcuts` 改。也可以點工具列圖示（先在拼圖選單裡釘選）。

- 在播放頁按：記錄這一刻。先截圖、再暫停影片，跳出小視窗。播放頁的網址是：
  - Netflix：`www.netflix.com/watch/數字`
  - YouTube：`www.youtube.com/watch?v=影片代碼`，也包含 Shorts（`/shorts/影片代碼`）和直播（`/live/影片代碼`）。首頁、搜尋頁、頻道頁不算播放頁
  - Disney+：`www.disneyplus.com/play/編號`（編號是一串 UUID，網址前面可以有語系，例如 `/zh-hant/play/…`；舊的 `/video/…` 也認得）
- 在其他任何頁面按：開啟筆記本。嵌在其他網站裡的 YouTube、`m.youtube.com`、YouTube Music、`youtu.be` 短網址都不算播放頁。
- 播放頁上滑鼠一動，會浮出「記下這一刻」按鈕，點它跟按快捷鍵一樣，停動約 3 秒後淡出。Netflix、Disney+ 的按鈕在視窗右下角；YouTube 的按鈕貼在播放器的右下角（只有滑鼠在播放器上才會出現，頁面捲動就收起來）。第一次用的差別見下面「已知限制」。

小視窗的按鍵：

| 按鍵 | 作用 |
|---|---|
| `Enter` | 存檔，影片繼續播放 |
| `Shift+Enter` | 心得換行 |
| `Esc` | 取消，影片繼續播放，不留筆記 |

- 台詞欄可以改；在台詞欄按 `Enter` 會跳到心得欄。
- 心得可以留空，事後再補。
- 打字時各平台的快捷鍵（空白鍵、F、K 等）不會被觸發；中文輸入法選字的 `Enter` 不算存檔。
- 這一刻有哪一項沒抓到（圖、台詞、片名），小視窗會直接列出來。
- 小視窗上方的小畫面是這支影片前面記過的筆記（最多兩格，最近的在右邊）。點一格可以打開、修改那一則，也可以按「刪除這一則」刪掉：要按兩次，第一次會變成「確定刪除？」，3 秒內沒再按就取消。刪掉後小畫面會補上更早的筆記。

筆記本頁面（也是擴充功能的選項頁）：

- 筆記依「平台＋片子」分組，每組標題旁有平台小標籤（Netflix、YouTube、Disney+），影集會標季、集。
- 點時間按鈕：跳回那一刻。同一部片已經開著（同平台、同一支）就切過去並暫停在那一秒；沒開就開新分頁：
  - Netflix、YouTube：從那一秒播放（連結本身帶秒數）。
  - Disney+：連結帶不了秒數，新分頁會先從 Disney+ 上次看到的地方開始，擴充功能每秒叫播放器跳一次，直到跳成功並暫停在那一秒，最多等 30 秒（實測約 5 到 6 秒）。超過 30 秒還沒跳成功就停在原地，console 會留一行 `[resonnote] could not seek the Disney+ tab…`。
- 心得可以直接改，停止打字約半秒後自動存檔，離開輸入框、切走分頁或關掉頁面時也會存。同一則如果已經在別處（例如小視窗）刪掉，存心得時會提示「這則筆記已經在別處刪除，剛寫的心得沒有存」，筆記不會被救回來。「刪除」要按兩次才會刪。
- 畫面是用進度條小圖存下來的筆記（完整截圖被擋時，只有 Netflix 有這個備案），縮圖旁會標「低解析度」。YouTube 的影片原畫面備案畫質是完整的，不會標。
- 勾選筆記後可以匯出：
  - 複製圖卡／下載圖卡：LINE 用的 PNG（寬 1080 px）。複製一次只能選一則；下載可以多則，會一張張下載。
  - 匯出網頁檔：單一 HTML，圖片內嵌，離線與手機都能開。
  - 匯出 Markdown：`notes.md` 加 `images/` 的 zip，當 blog 素材。片名、台詞、心得都當純文字寫入（`<`、`>`、`&`、`[`、`]` 等會被跳脫），所以心得裡自己寫的 Markdown 連結語法不會變成連結。
  - 這兩種都會附連結回那一刻：Netflix、YouTube 的文字是「在 Netflix 從 16:43 開始看」，點了從那一秒播；Disney+ 的文字是「在 Disney+ 打開（這一刻在 16:43）」，點了只會開到那一集，不會跳到那一秒。
- 每個分組有「全選」，等於匯出整部片。
- 「全部備份」會跳出存檔視窗，存成 zip；「從備份還原」讀同格式的 zip，`id` 相同的筆記以 `updatedAt` 較新的為準。

## 備份提醒

筆記存在擴充功能自己的 IndexedDB。**移除擴充功能會連筆記和圖片一起刪掉**。請定期按「全部備份」；筆記本頁面會顯示「上次備份」，超過 14 天會用醒目顏色提醒。只有確定檔案已經寫好，「上次備份」才會更新：在存檔視窗按取消不算；瀏覽器沒有存檔視窗而改用一般下載時，因為無法確認檔案真的存好，也不會更新。

## 隱私

- 筆記（片名、秒數、台詞、心得）和截圖都只存在你瀏覽器本機的擴充功能 IndexedDB，不會上傳到任何伺服器。沒有帳號，沒有分析或追蹤。
- 擴充功能唯一會主動向網路讀資料的地方，都在 Netflix 頁面內、只讀不寫：向 netflix.com 讀這部片的片名資料，以及重新讀取 Netflix 頁面本來就載入過的進度條小圖檔（網址取自頁面自己的資源紀錄，是畫面的備案來源）。兩者都不含任何筆記內容。YouTube、Disney+ 頁面內沒有任何擴充功能發出的網路請求。點時間按鈕開新分頁，只是用瀏覽器開啟該平台的影片網址。
- 權限只有 `activeTab`、`storage`、`unlimitedStorage`，以及 `www.netflix.com`、`www.youtube.com`、`www.disneyplus.com` 三個網站。
- 備份、匯出都是在本機產生檔案下載，不經過任何伺服器。

## 已知限制

- 只在 macOS 的 Chrome 上實測過；其他系統與瀏覽器沒測。
- 這是依賴各平台頁面內部結構的做法，網站改版就可能壞。設計上哪一項壞掉就只少那一項，記錄流程本身不會中斷。各平台的退路：
  - Netflix
    - 播放器內部介面讀不到：秒數改讀 `<video>`，跳回改成開那部片。
    - 片名讀不到：用分頁標題，再不行用片子編號。
    - 台詞讀不到：留空，自己打。
    - 完整截圖失敗或拿到全黑畫面：改用進度條小圖，標記「低解析度」。
    - 進度條小圖也沒有：筆記照存，沒有圖。
  - YouTube
    - 播放器內部介面讀不到：秒數與片子改讀網址和 `<video>`，片名用清理過的分頁標題（讀不到就用「YouTube 影片代碼」），暫停、播放、跳秒直接操作 `<video>`；小視窗會列出「播放器介面讀不到，秒數改從影片讀」。
    - 台詞：讀 YouTube 自己的字幕；剛開字幕或切換語言時，播放器上短暫出現的語言名稱不算台詞。沒字幕就留空，自己打。有裝 Language Reactor 時改讀它的字幕。
      - 只讀得到 CC 字幕：燒進影片畫面的字幕（很多中文頻道的大字幕）是影像不是文字，會留在截圖裡，但台詞欄讀不到；那種影片要把 CC 打開才有台詞。
      - CC 開了自動翻譯（設定裡的「中文 >> 英文」這種）時，讀到的是翻譯後的文字；機器翻譯的字幕是一段段跳出來的，按下去那一刻可能只有半句。
    - 完整截圖失敗或拿到全黑畫面：改用從 `<video>` 直接取的原畫面（畫質完整，但**不含字幕**，也不會標「低解析度」）。
    - 原畫面也沒有：筆記照存，沒有圖（YouTube 沒有進度條小圖備案）。
    - 廣告播放中不能記：廣告的秒數不是影片的秒數，所以廣告期間頁面上不會出現「記下這一刻」按鈕，按快捷鍵也沒反應，廣告結束再按。
    - 不存頻道名稱（YouTube 片名常已含頻道）。
  - Disney+
    - 秒數、片名、季與集、暫停、播放、跳秒都靠播放器內部介面。讀不到時**不會**退回 `<video>`（Disney+ 的 `<video>` 時間不是劇集時間）；改讀進度條上的秒數（控制列露出時才有），兩個都沒有就不記，按了沒反應。
    - 片名讀不到：用分頁標題（去掉「| Disney+」），再不行用「Disney+」加編號前 8 碼。
    - 季、集是解析播放器顯示的那一行文字（例如「第 1 季第 2 集：集名」），看不懂就整行當集名；電影沒有。
    - 沒有低解析度備案：完整截圖是唯一的畫面來源（受保護的影片無法從 `<video>` 取得畫面）。
    - 台詞讀不到：留空，自己打（不讀 Language Reactor）。
    - 連結不帶秒數：見上面「點時間按鈕」與匯出。
    - 有廣告方案的廣告沒有偵測，也沒測過。
- 完整截圖要靠 Chrome 的 `activeTab` 權限，而它只在你按過快捷鍵或工具列圖示的那個分頁才放行。所以在一個分頁**第一次**就用頁面按鈕：
  - YouTube：改用影片原畫面，筆記有圖，但**不含字幕**；在這個分頁按過一次快捷鍵（或點工具列圖示）之後，按鈕就截得到含字幕的完整畫面。
  - Netflix：改用進度條小圖，標「低解析度」，小視窗會提示先按一次快捷鍵。
  - Disney+：沒有圖，小視窗提示「請先在這個分頁按一次快捷鍵或工具列的 ResonNote 圖示」。
- 不支援：嵌在其他網站的 YouTube、`m.youtube.com`、YouTube Music、`youtu.be` 短網址分頁。YouTube 直播（`/live/`）網址會被當成播放頁，但沒實測過。
- 圖卡的換行沒有避頭尾規則，逗號、句號偶爾會出現在行首。
- 出問題時，console 裡有 `[resonnote]` 前綴的訊息可以查，回報問題時請附上。

## 開發

```sh
pnpm test      # Vitest
pnpm compile   # tsc --noEmit
pnpm build     # 輸出到 .output/chrome-mv3
pnpm dev       # WXT 開發模式
pnpm zip       # .output/resonnote-<版本>-chrome.zip，帶 key，給 GitHub Release 用
pnpm zip:store # .output/resonnote-<版本>-chrome-store.zip，不帶 key，給商店上架用
```

- 各平台的轉接層在 `src/platforms/`（`netflix/`、`youtube/`、`disney/` 各一個資料夾，由 `registry.ts` 註冊）；WXT 的進入點在 `src/entrypoints/`。
- IndexedDB 資料庫名稱是 `scenenote`，沿用舊專案名稱，讓舊筆記與舊備份都能照常讀取；改名等於換一個資料庫，既有筆記會讀不到，請不要改。程式內的訊息類型、console 前綴等都是 `resonnote`。
- `wxt.config.ts` 的 manifest 固定了 `key`，所以從原始碼或 GitHub Release 安裝的版本，不管資料夾放哪裡，擴充功能 ID 都固定是 `bldeoidbgkcdnmiholglmknnimdhnhff`。沒有固定 `key` 的話，開發人員模式載入的 ID 會跟著資料夾路徑變，IndexedDB 也跟著換，舊筆記就讀不到。
- 之後上架商店的版本會是另一個 ID（商店會自己指派，所以 `pnpm zip:store` 產出的商店版 manifest 不帶 `key`，其餘跟一般版完全相同），兩者的筆記不互通。要搬就用「全部備份」再「從備份還原」。
- fork 後如果要自行發行，請換成自己的 `key`。

## 貢獻

歡迎回報問題與提交 PR，開發流程與規範見 [CONTRIBUTING.md](CONTRIBUTING.md)。安全性問題請照 [SECURITY.md](SECURITY.md) 私下回報。

## 免責聲明

這是個人開源專案，與 Netflix、YouTube（Google）、Disney+ 沒有任何關係，也未獲其背書或贊助。Netflix、YouTube、Google、Disney+ 等名稱與商標屬各自的所有者，這裡僅用來說明本擴充功能支援的網站。

擷取的畫面與台詞，版權屬原權利人，僅供個人筆記用途。請勿公開散布侵權內容。各網站改版可能讓部分或全部功能失效，作者不保證持續可用。

## 授權

[MIT](LICENSE) © 2026 Bobo Chen
