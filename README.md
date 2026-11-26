# 專案控制台

一頁看完所有 vibe coding 平台的狀態：網站是否打得開、回應時間、24 小時與 7 天可用率、Supabase 是否被暫停、最後 commit、最近部署、未合併的 PR。之後會再接上 Notion 待辦與 Google 行事曆（第二階段）。

## 架構

| 部分 | 做法 |
|---|---|
| 網頁 | Vite + React + TypeScript，建置到 `dist/` |
| 主機 | 一個 Cloudflare Worker，同時負責網頁、`/api/*` 和排程 |
| 排程 | Cron 每 30 分鐘跑一輪檢查（`wrangler.jsonc` 的 `triggers`） |
| 資料 | Cloudflare D1（SQLite），保留 30 天；第一次用到時自動建表 |
| 登入 | 一組密碼（Secret `DASHBOARD_PASSWORD`），登入後 30 天內免輸入；沒設密碼時整站不開放 |
| 專案清單 | `projects.json` |

檢查內容：

- **網站**：GET 首頁，2xx/3xx 算正常（`okStatus` 可加例外，例如整站密碼保護回 401）。
- **Supabase**：不帶金鑰打 `https://<代號>.supabase.co/rest/v1/`，活著的專案會回 401「No API key found」，其他回應都當作可能被暫停。
- **GitHub**：一次 GraphQL 查全部 repo 的最後 commit、檢查結果、開著的 PR、最近部署。需要 `GITHUB_TOKEN`。
- **網域**：有填 `domain` 的專案每天用 RDAP 查一次到期日，30 天內到期會提醒。
- 平台給的網址（`*.vercel.app`、`*.workers.dev`、`github.io`）憑證都是自動續約，所以不另外查 SSL。

## 新增或修改平台

編輯 `projects.json`，push 之後 Cloudflare 會自動重新部署。

```json
{
  "id": "my-app",
  "name": "顯示名稱",
  "summary": "一句話說明",
  "repo": "GitHub repo 名稱",
  "url": "https://my-app.vercel.app/",
  "host": "vercel",
  "supabase": "Supabase 專案代號（可省略）",
  "domain": "自訂網域（可省略）",
  "notes": "Notion 筆記連結（可省略）"
}
```

`host` 是 `vercel`、`cloudflare` 或 `github-pages`。

## 第一次部署（Cloudflare 後台操作）

1. **建 D1 資料庫**：Storage & Databases → D1 SQL Database → Create，名稱 `life-dashboard`。把 Database ID 貼到 `wrangler.jsonc` 的 `database_id`。
2. **連 GitHub 自動部署**：Workers & Pages → Create → Import a repository → 選這個 repo。
   - Build command：`npm run build`
   - Deploy command：`npx wrangler deploy`
3. **設定登入密碼**：Worker 的 Settings → Variables and Secrets → Add，類型選 Secret，名稱 `DASHBOARD_PASSWORD`，至少 12 個字。沒設之前網站只會顯示設定說明，不會露出任何資料。
4. **GitHub 權杖**：GitHub → Settings → Developer settings → Fine-grained tokens，Repository access 選 All repositories，權限全部唯讀：Contents、Metadata、Pull requests、Commit statuses、Deployments、Actions。到 Worker 的 Settings → Variables and Secrets 新增 Secret `GITHUB_TOKEN`。

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
