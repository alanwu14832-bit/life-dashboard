// 登入頁與「還沒設定密碼」頁。由 Worker 直接回傳，沒登入時拿不到網站的任何檔案。

const STYLE = `
:root{--bg:#ebeae6;--paper:#f6f5f2;--ink:#1c1c1a;--muted:#67655f;--line:#d6d4cd;--accent:#2f5d50;--down:#a3301d;--down-soft:#f3e1dc;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.65 'IBM Plex Sans','PingFang TC','Noto Sans TC','Microsoft JhengHei',system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
main{width:100%;max-width:360px;display:flex;flex-direction:column;gap:18px}
.brand{font-size:13px;font-weight:600;letter-spacing:.12em;color:var(--muted)}
h1{margin:0;font:700 30px/1.25 'Noto Serif TC','Songti TC','PMingLiU',serif;letter-spacing:.02em;padding-bottom:14px;border-bottom:1px solid var(--ink)}
p{margin:0;color:var(--muted);font-size:13px}
form{display:flex;flex-direction:column;gap:12px}
label{font-size:13px;font-weight:500}
input{font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:2px;background:var(--paper);color:var(--ink);width:100%}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:500 15px/1 inherit;font-family:inherit;letter-spacing:.06em;padding:12px 16px;border:0;border-radius:2px;background:var(--ink);color:var(--paper);cursor:pointer}
.error{background:var(--down-soft);color:var(--down);padding:8px 12px;border-left:2px solid currentColor;font-size:14px}
code{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--paper:#1f1f1c;--ink:#e8e6e0;--muted:#a3a097;--line:#34332e;--accent:#8fc2ac;--down:#ec8a76;--down-soft:#34201b;color-scheme:dark}}
`;

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-Hant-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${escape(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Serif+TC:wght@700&display=swap">
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function loginPage(error?: string): string {
  return shell(
    '登入｜專案控制台',
    `<div class="brand">專案控制台</div>
<h1>登入</h1>
<form method="post" action="/login">
  <label for="password">密碼</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  ${error ? `<div class="error" role="alert">${escape(error)}</div>` : ''}
  <button type="submit">登入</button>
</form>
<p>登入後 30 天內不用再輸入。</p>`,
  );
}

export function setupPage(reason: string): string {
  return shell(
    '尚未設定密碼｜專案控制台',
    `<h1>還沒設定登入密碼</h1>
<p>${escape(reason)}</p>
<p>到 Cloudflare 後台：Workers &amp; Pages → life-dashboard → Settings → Variables and Secrets，新增一個類型為 Secret、名稱為 <code>DASHBOARD_PASSWORD</code> 的變數。存檔後重新整理這頁。</p>`,
  );
}
