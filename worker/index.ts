import type { DomainInfo, GithubSnapshot, Overview } from '../shared/types';
import {
  clearCookie,
  clearFailures,
  COOKIE_NAME,
  createSession,
  MAX_FAILURES,
  MIN_PASSWORD_LENGTH,
  passwordMatches,
  readCookie,
  recentFailures,
  recordFailure,
  sameOrigin,
  sessionCookie,
  verifySession,
} from './auth';
import { checkHttp, checkSupabase, fetchDomain, fetchGithub, withRetry } from './checks';
import { deriveHealth, sortByHealth } from './health';
import { completeTask, NotionError } from './notion';
import { loginPage, setupPage } from './pages';
import {
  activeProjects,
  createProject,
  deleteProject,
  listProjects,
  OWNER,
  reorderProjects,
  updateProject,
  validateProject,
  ValidationError,
} from './projects';
import { cachedToday, invalidateToday } from './today';
import { checkKey, ensureSchema, getKv, insertChecks, setKv, summarize } from './store';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string;
  DASHBOARD_PASSWORD?: string;
  NOTION_TOKEN?: string;
  CALENDAR_ICS_URL?: string;
}

const MIN_MANUAL_GAP_MS = 60_000;
const DOMAIN_REFRESH_MS = 86_400_000;

/** 跑一輪全部檢查並寫進資料庫。排程每 30 分鐘呼叫一次，也可以從頁面手動觸發。 */
export async function runChecks(env: Env): Promise<void> {
  await ensureSchema(env.DB);
  const ts = Date.now();
  const projects = await activeProjects(env.DB);
  const owner = OWNER;

  // 同一個 Supabase 專案只打一次，結果分給共用它的專案
  const refs = [...new Set(projects.map((p) => p.supabase).filter((r): r is string => !!r))];

  const [httpResults, supaResults, github] = await Promise.all([
    Promise.all(projects.map((p) => (p.url ? withRetry(() => checkHttp(p.url!, p.okStatus)) : Promise.resolve(null)))),
    Promise.all(refs.map((r) => withRetry(() => checkSupabase(r)))),
    fetchGithub(owner, projects, env.GITHUB_TOKEN),
  ]);
  const supaByRef = new Map(refs.map((r, i) => [r, supaResults[i]]));

  const rows = projects.flatMap((p, i) => {
    const out = [];
    const http = httpResults[i];
    if (http) out.push({ project: p.id, kind: 'http' as const, result: http });
    const supa = p.supabase ? supaByRef.get(p.supabase) : undefined;
    if (supa) out.push({ project: p.id, kind: 'supabase' as const, result: supa });
    return out;
  });

  await insertChecks(env.DB, ts, rows);
  await setKv(env.DB, 'github', github, ts);

  const withDomain = projects.filter((p) => p.domain);
  if (withDomain.length) {
    const prev = await getKv<Record<string, DomainInfo>>(env.DB, 'domains');
    if (!prev || ts - prev.ts > DOMAIN_REFRESH_MS) {
      const list = await Promise.all(withDomain.map((p) => fetchDomain(p.domain!)));
      await setKv(env.DB, 'domains', Object.fromEntries(withDomain.map((p, i) => [p.id, list[i]])), ts);
    }
  }

  await setKv(env.DB, 'lastRun', { ts, ms: Date.now() - ts }, ts);
}

export async function buildOverview(env: Env): Promise<Overview> {
  await ensureSchema(env.DB);
  const now = Date.now();
  const [summary, github, domains, lastRun] = await Promise.all([
    summarize(env.DB, now),
    getKv<GithubSnapshot>(env.DB, 'github'),
    getKv<Record<string, DomainInfo>>(env.DB, 'domains'),
    getKv<{ ts: number; ms: number }>(env.DB, 'lastRun'),
  ]);

  const configs = await activeProjects(env.DB);
  const projects = configs.map((config) => {
    const up = summary.uptime.get(checkKey(config.id, 'http'));
    return deriveHealth({
      config,
      now,
      latestHttp: summary.latest.get(checkKey(config.id, 'http')) ?? null,
      uptime24h: up?.d1 ?? null,
      uptime7d: up?.d7 ?? null,
      recent: summary.recent.get(config.id) ?? [],
      supabase: summary.latest.get(checkKey(config.id, 'supabase')) ?? null,
      repo: github?.v.repos[config.id] ?? null,
      domain: domains?.v[config.id] ?? null,
    });
  });

  return {
    generatedAt: now,
    lastRun: lastRun?.v ?? null,
    github: github ? { ts: github.v.ts, error: github.v.error } : null,
    projects: sortByHealth(projects),
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-robots-tag': 'noindex, nofollow',
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
};

function secure(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const redirect = (location: string, extra: Record<string, string> = {}) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store', ...extra } });

async function handleLogin(req: Request, env: Env, password: string): Promise<Response> {
  await ensureSchema(env.DB);
  const now = Date.now();
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if ((await recentFailures(env.DB, ip, now)) >= MAX_FAILURES)
    return html(loginPage('密碼錯太多次，15 分鐘後再試。'), 429);

  const form = await req.formData().catch(() => null);
  const input = form?.get('password');
  if (typeof input !== 'string' || !(await passwordMatches(input, password))) {
    await recordFailure(env.DB, ip, now);
    return html(loginPage('密碼不對。'), 401);
  }
  await clearFailures(env.DB, ip);
  return redirect('/', { 'set-cookie': sessionCookie(await createSession(password, now)) });
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const isApi = pathname.startsWith('/api/');

  // 沒設密碼（或太短）時整站關閉，不會因為忘了設定就公開
  const password = env.DASHBOARD_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    const reason = !password
      ? '為了保護資料，設定密碼之前網站不會顯示任何內容。'
      : `目前的密碼太短，至少要 ${MIN_PASSWORD_LENGTH} 個字。`;
    return isApi ? json({ error: reason }, 503) : html(setupPage(reason), 503);
  }

  // 會改資料的請求（POST、PUT、DELETE…）只接受同一個網站送來的
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return json({ error: '拒絕來自其他網站的請求' }, 403);

  if (pathname === '/login') {
    if (req.method === 'POST') return handleLogin(req, env, password);
    return redirect('/');
  }
  if (pathname === '/logout' && req.method === 'POST') return redirect('/', { 'set-cookie': clearCookie });

  if (!(await verifySession(password, readCookie(req, COOKIE_NAME), Date.now()))) {
    if (isApi) return json({ error: '登入已過期，請重新整理頁面' }, 401);
    return html(loginPage(), 401);
  }

  if (pathname === '/api/overview' && req.method === 'GET') return json(await buildOverview(env));

  if (pathname === '/api/today' && req.method === 'GET') return json(await cachedToday(env, url.searchParams.has('fresh')));

  const done = /^\/api\/tasks\/([0-9a-fA-F-]{32,36})\/complete$/.exec(pathname);
  if (done && req.method === 'POST') {
    if (!env.NOTION_TOKEN) return json({ error: '還沒設定 NOTION_TOKEN' }, 503);
    try {
      await completeTask(env.NOTION_TOKEN, done[1]);
      invalidateToday();
      return json({ ok: true });
    } catch (err) {
      if (err instanceof NotionError) return json({ error: err.message }, 502);
      throw err;
    }
  }

  if (pathname === '/api/run' && req.method === 'POST') {
    await ensureSchema(env.DB);
    const last = await getKv<{ ts: number }>(env.DB, 'lastRun');
    if (last && Date.now() - last.v.ts < MIN_MANUAL_GAP_MS)
      return json({ error: '一分鐘內剛檢查過，稍等一下再按' }, 429);
    await runChecks(env);
    return json(await buildOverview(env));
  }

  // 設定頁：平台清單
  if (pathname === '/api/projects') {
    try {
      if (req.method === 'GET') return json({ owner: OWNER, projects: await listProjects(env.DB) });
      if (req.method === 'POST') {
        await createProject(env.DB, validateProject(await req.json()));
        return json({ owner: OWNER, projects: await listProjects(env.DB) }, 201);
      }
    } catch (err) {
      if (err instanceof ValidationError || err instanceof SyntaxError) return json({ error: err.message }, 400);
      throw err;
    }
  }
  if (pathname === '/api/projects/order' && req.method === 'POST') {
    try {
      await reorderProjects(env.DB, ((await req.json()) as { ids?: unknown }).ids);
      return json({ owner: OWNER, projects: await listProjects(env.DB) });
    } catch (err) {
      if (err instanceof ValidationError || err instanceof SyntaxError) return json({ error: err.message }, 400);
      throw err;
    }
  }
  const one = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,39})$/.exec(pathname);
  if (one && (req.method === 'PUT' || req.method === 'DELETE')) {
    try {
      if (req.method === 'PUT') await updateProject(env.DB, one[1], validateProject(await req.json()));
      else await deleteProject(env.DB, one[1]);
      return json({ owner: OWNER, projects: await listProjects(env.DB) });
    } catch (err) {
      if (err instanceof ValidationError || err instanceof SyntaxError) return json({ error: err.message }, 400);
      throw err;
    }
  }

  if (isApi) return json({ error: '找不到這個 API' }, 404);
  const asset = await env.ASSETS.fetch(req);
  // Vite 產生的 /assets/* 檔名帶內容雜湊，內容變了檔名就變，可以放心長期快取
  if (pathname.startsWith('/assets/') && asset.ok) {
    const res = new Response(asset.body, asset);
    res.headers.set('cache-control', 'private, max-age=31536000, immutable');
    return res;
  }
  // 首頁要登入才看得到，不讓中間的代理伺服器快取
  const res = new Response(asset.body, asset);
  res.headers.set('cache-control', 'private, no-cache');
  return res;
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return secure(await route(req, env));
    } catch (err) {
      console.error(err);
      return secure(json({ error: err instanceof Error ? err.message : String(err) }, 500));
    }
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runChecks(env));
  },
} satisfies ExportedHandler<Env>;

