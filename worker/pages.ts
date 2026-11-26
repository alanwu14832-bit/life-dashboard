// 登入頁與「還沒設定密碼」頁。由 Worker 直接回傳，沒登入時拿不到網站的任何檔案。

const STYLE = `
:root{--bg:#eef1f5;--surface:#fff;--ink:#16202b;--muted:#5a6776;--line:#d9e0e8;--accent:#1f5fbf;--accent-ink:#fff;--down:#b42318;--down-soft:#fbe6e3;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0e1319;--surface:#151c24;--ink:#e5eaf0;--muted:#93a1b1;--line:#27323e;--accent:#6c9ff0;--accent-ink:#0b1220;--down:#f2705f;--down-soft:#351a17;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.55 'IBM Plex Sans','PingFang TC','Noto Sans TC','Microsoft JhengHei',system-ui,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
main{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:28px 24px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font-size:20px;font-weight:600}
p{margin:0;color:var(--muted);font-size:14px}
form{display:flex;flex-direction:column;gap:12px}
label{font-size:13px;color:var(--muted)}
input{font:inherit;padding:10px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);width:100%}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:500 15px/1 inherit;font-family:inherit;padding:11px 16px;border-radius:8px;border:0;background:var(--accent);color:var(--accent-ink);cursor:pointer}
.error{background:var(--down-soft);color:var(--down);padding:8px 12px;border-radius:8px;font-size:14px}
code{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:13px}
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
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function loginPage(error?: string): string {
  return shell(
    '登入｜專案控制台',
    `<h1>專案控制台</h1>
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
