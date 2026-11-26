import registryJson from '../projects.json';
import type { DomainInfo, GithubSnapshot, Overview, Registry } from '../shared/types';
import { checkHttp, checkSupabase, fetchDomain, fetchGithub } from './checks';
import { deriveHealth, sortByHealth } from './health';
import { checkKey, ensureSchema, getKv, insertChecks, setKv, summarize } from './store';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GITHUB_TOKEN?: string;
}

const registry = registryJson as Registry;
const MIN_MANUAL_GAP_MS = 60_000;
const DOMAIN_REFRESH_MS = 86_400_000;

/** 跑一輪全部檢查並寫進資料庫。排程每 30 分鐘呼叫一次，也可以從頁面手動觸發。 */
export async function runChecks(env: Env): Promise<void> {
  await ensureSchema(env.DB);
  const ts = Date.now();
  const { projects, owner } = registry;

  // 同一個 Supabase 專案只打一次，結果分給共用它的專案
  const refs = [...new Set(projects.map((p) => p.supabase).filter((r): r is string => !!r))];

  const [httpResults, supaResults, github] = await Promise.all([
    Promise.all(projects.map((p) => (p.url ? checkHttp(p.url, p.okStatus) : Promise.resolve(null)))),
    Promise.all(refs.map((r) => checkSupabase(r))),
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

  const projects = registry.projects.map((config) => {
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

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    try {
      if (pathname === '/api/overview' && req.method === 'GET') return json(await buildOverview(env));

      if (pathname === '/api/run' && req.method === 'POST') {
        await ensureSchema(env.DB);
        const last = await getKv<{ ts: number }>(env.DB, 'lastRun');
        if (last && Date.now() - last.v.ts < MIN_MANUAL_GAP_MS)
          return json({ error: '一分鐘內剛檢查過，稍等一下再按' }, 429);
        await runChecks(env);
        return json(await buildOverview(env));
      }

      if (pathname.startsWith('/api/')) return json({ error: '找不到這個 API' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runChecks(env));
  },
} satisfies ExportedHandler<Env>;
