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
import { composeMail, ensureIncidents, processSignals, sendMail, type Signal } from './alerts';
import { checkHttp, checkSupabase, fetchDomain, fetchGithub, withRetry } from './checks';
import { deriveHealth, sortByHealth } from './health';
import { completeTask, createTask, fetchSchedules, NotionError } from './notion';
import { taipeiMinutes, weekday, ymdIn } from './time';
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
import { buildWeekly, composeWeeklyMail } from './weekly';
import { checkKey, ensureSchema, getKv, insertChecks, projectHistory, setKv, summarize } from './store';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string;
  DASHBOARD_PASSWORD?: string;
  NOTION_TOKEN?: string;
  CALENDAR_ICS_URL?: string;
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL?: string;
  SITE_URL?: string;
}

const MIN_MANUAL_GAP_MS = 60_000;
const MAX_MUTE_MINUTES = 24 * 60;

/** 還在維護時段的平台：{ 平台代號: 結束時間 } */
async function activeMutes(db: D1Database, now: number): Promise<Record<string, number>> {
  const all = (await getKv<Record<string, number>>(db, 'mutes'))?.v ?? {};
  return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now));
}
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.svg']);
/** 週日晚上 9 點（台北）寄週報 */
const WEEKLY_CRON = '0 13 * * SUN';
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
  let domains: Record<string, DomainInfo> = {};
  if (withDomain.length) {
    const prev = await getKv<Record<string, DomainInfo>>(env.DB, 'domains');
    domains = prev?.v ?? {};
    if (!prev || ts - prev.ts > DOMAIN_REFRESH_MS) {
      const list = await Promise.all(withDomain.map((p) => fetchDomain(p.domain!)));
      domains = Object.fromEntries(withDomain.map((p, i) => [p.id, list[i]]));
      await setKv(env.DB, 'domains', domains, ts);
    }
  }

  // ── 異常通知 ──
  const prevResults = (await getKv<Record<string, boolean>>(env.DB, 'lastResults'))?.v ?? {};
  const results: Record<string, boolean> = {};
  const signals: Signal[] = [];
  for (const r of rows) {
    const key = `${r.kind === 'http' ? 'site' : 'supabase'}:${r.project}`;
    const name = projects.find((p) => p.id === r.project)?.name ?? r.project;
    results[key] = r.result.ok;
    signals.push({
      key,
      project: r.project,
      label: r.kind === 'http' ? `${name} 網站` : `${name} 的 Supabase`,
      failing: !r.result.ok,
      prevFailing: prevResults[key] === false,
      detail: r.kind === 'http' ? `打不開（${r.result.error ?? '未知錯誤'}）` : '沒有正常回應，可能被暫停',
    });
  }
  for (const p of withDomain) {
    const d = domains[p.id];
    if (!d?.expires) continue;
    const days = Math.floor((Date.parse(d.expires) - ts) / 86_400_000);
    signals.push({
      key: `domain:${p.id}`,
      project: p.id,
      label: `${p.name} 的網域 ${d.domain}`,
      failing: days < 30,
      prevFailing: true,
      detail: `${days} 天後到期（${d.expires.slice(0, 10)}），記得續約`,
    });
  }
  // 排程：平日傍晚 6 點後還沒寫入今天那一筆；寫進去之後會寄「恢復」
  const today = ymdIn(ts);
  const dow = weekday(today);
  if (env.NOTION_TOKEN && dow !== 0 && dow !== 6 && taipeiMinutes(ts) >= 18 * 60) {
    try {
      for (const sch of await fetchSchedules(env.NOTION_TOKEN, today, ts)) {
        signals.push({
          key: `schedule:${sch.name}:${today}`,
          project: null,
          label: `排程「${sch.name}」`,
          failing: sch.state === 'late',
          prevFailing: true,
          detail: `今天還沒有寫入（最新一筆是 ${sch.latestDate ?? '無'}），排程可能斷了`,
        });
      }
    } catch {
      // Notion 讀不到就這次不判斷排程
    }
  }
  // 維護中的平台：照樣記錄檢查結果，但當作正常，不開異常、不寄信
  const mutes = await activeMutes(env.DB, ts);
  for (const sg of signals) if (sg.project && mutes[sg.project]) sg.failing = false;
  const changes = (await processSignals(env.DB, signals, ts)).filter((c) => !(c.signal.project && mutes[c.signal.project]));
  await setKv(env.DB, 'lastResults', results, ts);
  const mail = composeMail(changes, ts, env.SITE_URL ?? 'https://life-dashboard.workers.dev');
  if (mail) {
    const sent = await sendMail(env, mail);
    await setKv(env.DB, 'notifyLast', { ts, subject: mail.subject, ...sent }, ts);
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
  const mutes = await activeMutes(env.DB, now);
  const projects = configs.map((config) => {
    const up = summary.uptime.get(checkKey(config.id, 'http'));
    const view = deriveHealth({
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
    return { ...view, mutedUntil: mutes[config.id] ?? null };
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
  // 加到主畫面用的 manifest 與圖示：瀏覽器抓它們時不帶登入 cookie，內容也沒有個人資料
  if (PUBLIC_FILES.has(pathname) && (req.method === 'GET' || req.method === 'HEAD')) return env.ASSETS.fetch(req);

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

  if (pathname === '/api/tasks' && req.method === 'POST') {
    if (!env.NOTION_TOKEN) return json({ error: '還沒設定 NOTION_TOKEN' }, 503);
    try {
      const body = (await req.json()) as { title?: unknown; due?: unknown };
      const created = await createTask(env.NOTION_TOKEN, String(body.title ?? ''), typeof body.due === 'string' ? body.due : null);
      invalidateToday();
      return json(created, 201);
    } catch (err) {
      if (err instanceof NotionError || err instanceof SyntaxError) return json({ error: err.message }, 400);
      throw err;
    }
  }

  if (pathname === '/api/weekly' && req.method === 'GET') {
    await ensureSchema(env.DB);
    await ensureIncidents(env.DB);
    return json(await buildWeekly(env));
  }

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

  // 設定頁：通知
  if (pathname === '/api/notify' && req.method === 'GET') {
    const last = await getKv<{ ts: number; subject: string; ok: boolean; error: string | null }>(env.DB, 'notifyLast');
    await ensureIncidents(env.DB);
    const { results: open } = await env.DB
      .prepare('SELECT label, detail, opened_at FROM incidents WHERE closed_at IS NULL ORDER BY opened_at DESC')
      .all<{ label: string; detail: string; opened_at: number }>();
    return json({ configured: !!(env.RESEND_API_KEY && env.NOTIFY_EMAIL), last: last?.v ?? null, open });
  }
  if (pathname === '/api/notify/test' && req.method === 'POST') {
    const ts = Date.now();
    const mail = {
      subject: '【測試】專案控制台通知',
      text: `這是一封測試信。收到就代表異常通知設定成功。\n\n之後網站或 Supabase 連續兩次檢查失敗、網域快到期、排程斷掉時，會寄信到這個信箱；恢復時也會通知。\n\n控制台：${env.SITE_URL ?? ''}`,
    };
    const sent = await sendMail(env, mail);
    await setKv(env.DB, 'notifyLast', { ts, subject: mail.subject, ...sent }, ts);
    return json(sent, sent.ok ? 200 : 502);
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
  const mute = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,39})\/mute$/.exec(pathname);
  if (mute && req.method === 'POST') {
    await ensureSchema(env.DB);
    const minutes = Number(((await req.json().catch(() => ({}))) as { minutes?: unknown }).minutes);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_MUTE_MINUTES)
      return json({ error: `暫停時間要在 0～${MAX_MUTE_MINUTES} 分鐘之間` }, 400);
    const now = Date.now();
    const mutes = await activeMutes(env.DB, now);
    if (minutes === 0) delete mutes[mute[1]];
    else mutes[mute[1]] = now + minutes * 60_000;
    await setKv(env.DB, 'mutes', mutes, now);
    return json({ mutedUntil: mutes[mute[1]] ?? null });
  }

  const hist = /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,39})\/history$/.exec(pathname);
  if (hist && req.method === 'GET') {
    await ensureSchema(env.DB);
    await ensureIncidents(env.DB);
    const now = Date.now();
    const [h, inc] = await Promise.all([
      projectHistory(env.DB, hist[1], now),
      env.DB
        .prepare('SELECT label, detail, opened_at AS openedAt, closed_at AS closedAt FROM incidents WHERE project = ? ORDER BY opened_at DESC LIMIT 30')
        .bind(hist[1])
        .all<{ label: string; detail: string | null; openedAt: number; closedAt: number | null }>(),
    ]);
    return json({ ...h, incidents: inc.results });
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

  async scheduled(event, env, ctx): Promise<void> {
    if (event.cron === WEEKLY_CRON) {
      ctx.waitUntil(
        (async () => {
          await ensureSchema(env.DB);
          await ensureIncidents(env.DB);
          const mail = composeWeeklyMail(await buildWeekly(env), env.SITE_URL ?? '');
          const sent = await sendMail(env, mail);
          await setKv(env.DB, 'notifyLast', { ts: Date.now(), subject: mail.subject, ...sent }, Date.now());
        })(),
      );
      return;
    }
    ctx.waitUntil(runChecks(env));
  },
} satisfies ExportedHandler<Env>;

