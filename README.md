# 專案控制台

一頁看完所有 vibe coding 平台的狀態，加上今天的行程與待辦：

- **平台**：網站是否打得開、回應時間、24 小時與 7 天可用率、Supabase 是否被暫停、最後 commit、最近部署、未合併的 PR、還有幾件待辦。
- **今天**：Google 行事曆今天與明天的行程、Notion 逾期／今天／7 天內的待辦（可直接勾選完成）、晨間簡報與台股收盤排程有沒有寫入、知識庫最近 7 天的筆記。

Notion 和 Google 行事曆仍是唯一的輸入處，這裡只負責看，以及把待辦標成完成。

## 架構

| 部分 | 做法 |
|---|---|
| 網頁 | Vite + React + TypeScript，建置到 `dist/` |
| 主機 | 一個 Cloudflare Worker，同時負責網頁、`/api/*` 和排程 |
| 排程 | Cron 每 30 分鐘跑一輪檢查（`wrangler.jsonc` 的 `triggers`） |
| 資料 | Cloudflare D1（SQLite），保留 30 天；第一次用到時自動建表 |
| 登入 | 一組密碼（Secret `DASHBOARD_PASSWORD`），登入後 30 天內免輸入；沒設密碼時整站不開放 |
| 平台清單 | 存在 D1，在網站右上角「設定」新增、編輯、排序、暫停監控；`projects.json` 只是第一次的預設值 |

檢查內容：

- **網站**：GET 首頁，2xx/3xx 算正常（`okStatus` 可加例外，例如整站密碼保護回 401）。
- **Supabase**：不帶金鑰打 `https://<代號>.supabase.co/rest/v1/`，活著的專案會回 401「No API key found」，其他回應都當作可能被暫停。
- **GitHub**：一次 GraphQL 查全部 repo 的最後 commit、檢查結果、開著的 PR、最近部署。需要 `GITHUB_TOKEN`。
- **網域**：有填 `domain` 的專案每天用 RDAP 查一次到期日，30 天內到期會提醒。
- 平台給的網址（`*.vercel.app`、`*.workers.dev`、`github.io`）憑證都是自動續約，所以不另外查 SSL。

## 新增或修改平台

到網站右上角「設定」。可以新增、編輯、上下排序、暫停監控（保留設定但不檢查）、刪除（會一併刪掉檢查紀錄）。

`projects.json` 只在資料庫還沒有任何平台時匯入一次，之後改它不會有效果。

## 第一次部署（Cloudflare 後台操作）

1. **建 D1 資料庫**：Storage & Databases → D1 SQL Database → Create，名稱 `life-dashboard`。把 Database ID 貼到 `wrangler.jsonc` 的 `database_id`。
2. **自動部署（GitHub Actions）**：每次 push 到 `main`，`.github/workflows/deploy.yml` 會跑測試、建置、`wrangler deploy`。要先在 GitHub repo 的 Settings → Secrets and variables → Actions 設定：
   - `CLOUDFLARE_API_TOKEN`：Cloudflare → 右上頭像 → Profile → API Tokens → Create Token → 用「Edit Cloudflare Workers」範本，再加一條 Account › D1 › Edit
   - `CLOUDFLARE_ACCOUNT_ID`：Workers & Pages 頁面右側的 Account ID
   - 不用 Cloudflare 內建的 Git 連線（Workers Builds），因為一個 GitHub 帳號只能連一個 Cloudflare 帳號，而校隊的 Cloudflare 帳號也用同一個 GitHub。
3. **設定登入密碼**：Worker 的 Settings → Variables and Secrets → Add，類型選 Secret，名稱 `DASHBOARD_PASSWORD`，至少 6 個字。沒設之前網站只會顯示設定說明，不會露出任何資料。
4. **GitHub 權杖**：GitHub → Settings → Developer settings → Fine-grained tokens，Repository access 選 All repositories，權限全部唯讀：Contents、Metadata、Pull requests、Commit statuses、Deployments、Actions。到 Worker 的 Settings → Variables and Secrets 新增 Secret `GITHUB_TOKEN`。

## 第二階段設定：Notion 與行事曆

兩個都存成 Worker 的 **Secret**（Settings → Variables and Secrets），不用重新部署。

- `NOTION_TOKEN`：notion.so/profile/integrations 建一個 Internal integration，權限勾 Read content 與 Update content，複製 Internal Integration Secret。再到這幾個資料庫右上角 ⋯ → Connections 把 integration 加進去：✅ Tasks 待辦事項、📊 晨間簡報、🇹🇼 台股收盤、🧠 Claude 知識庫，以及（選用，用來顯示課名）📚 Courses。
- `CALENDAR_ICS_URL`：Google 行事曆 → 設定 → 你的行事曆 → 整合日曆 → 「iCal 格式的私人網址」。

待辦的「平台 Platform」欄位選項要和 `projects.json` 的 `name` 一樣，卡片才會顯示待辦數。

行事曆解析是自己寫的輕量版本（`worker/ics.ts`），支援每天／每週／每月／每年重複、停課（EXDATE）、單次改時間（RECURRENCE-ID）與時區；解析結果快取 5 分鐘，以免超過免費方案每次 10ms 的 CPU 上限。

## 異常通知與詳細頁

- **通知（Email，經 Resend）**：網站或 Supabase 連續兩次檢查失敗（每次檢查本身已重試一次）、自訂網域 30 天內到期、平日 18:00 後晨間簡報或台股收盤還沒寫入時寄信；恢復時再寄一封並附上中斷多久。同一件事在恢復前不重複寄，同一次檢查的多個變化合成一封。
- 需要兩個 Secret：`RESEND_API_KEY`（resend.com → API Keys）與 `NOTIFY_EMAIL`（註冊 Resend 用的信箱；寄件人用 onboarding@resend.dev，只能寄給自己）。設定頁有「寄一封測試信」。
- **詳細頁**：卡片或列上的「詳細」，或網址 `#p-<代號>`。30 天每日可用率、7 天每小時回應時間、異常紀錄（保留 90 天）。

## 晨報附加功能

- **報頭**：台北天氣（Open-Meteo，免金鑰，快取 30 分鐘）；晨間簡報的「今日焦點」與台股收盤（加權指數、漲跌幅，紅漲綠跌）。
- **快速新增待辦**：「今天」區塊最上方輸入一行字，選今天／明天／不設日期，直接存進 Notion ✅ Tasks。
- **後台入口**：詳細頁有網站、GitHub、Actions、主機後台、Supabase、Notion 筆記的按鈕；主機後台的專案網址在設定頁填。
- **每週回顧**：網址 `#week`，週日晚上 9 點（台北）也會寄到信箱。內容是這 7 天完成的待辦、各平台可用率／commit／異常、新筆記、下週預告。
- **加到主畫面**：manifest 與圖示是公開檔案（不含個人資料），其他內容仍需登入。
- **維護時段**：詳細頁可暫停某個平台的通知 1 或 3 小時（最多 24 小時）。期間照樣檢查、記錄，但不開異常、不寄信；到期自動恢復。
- **深色版**：預設跟著系統外觀，頁尾可切換「自動／亮色／深色」（選擇存在這台裝置）。

## 登入機制

- 密碼存在 Cloudflare Secret，不在程式碼裡。登入後發一個簽章過的 cookie（HttpOnly、Secure、SameSite=Lax），30 天有效。
- 改密碼會讓所有裝置一起登出（簽章金鑰由密碼推導）。
- 同一個 IP 15 分鐘內錯 10 次就暫時鎖住。
- 所有請求（包括網頁檔案）都要先登入，排程檢查不受影響。

## 本機開發

```bash
npm install
npm test            # 單元測試
npm run preview     # 建置後用 wrangler dev 起在 http://localhost:8787（本機 D1）
```

本機要先把 `.dev.vars.example` 複製成 `.dev.vars`，填入測試用的密碼（和 GitHub 權杖，可省略）。這個檔不會進 git。

改前端時可以開兩個終端：一個 `npx wrangler dev`，一個 `npm run dev`（Vite 會把 `/api` 轉給 8787）。

`scripts/probe.ts` 會對真實網站跑一次檢查但不寫資料庫：

```bash
NODE_USE_ENV_PROXY=1 npx vite-node scripts/probe.ts
```
