import type { CheckRow, DomainInfo, Health, ProjectConfig, ProjectView, RepoInfo } from '../shared/types';

const DAY = 86_400_000;
export const STALE_DAYS = 30;
const SLOW_MS = 3_000;
const DOMAIN_WARN_DAYS = 30;

export interface HealthInput {
  config: ProjectConfig;
  now: number;
  latestHttp: CheckRow | null;
  uptime24h: number | null;
  uptime7d: number | null;
  recent: ProjectView['http']['recent'];
  supabase: CheckRow | null;
  repo: RepoInfo | null;
  domain: DomainInfo | null;
}

/** 把各項檢查結果合成一個燈號，原因依嚴重程度排。 */
export function deriveHealth(i: HealthInput): ProjectView {
  const down: string[] = [];
  const warn: string[] = [];

  if (i.config.url && i.latestHttp && !i.latestHttp.ok) down.push(`網站打不開（${i.latestHttp.error ?? '未知錯誤'}）`);
  if (i.supabase && !i.supabase.ok) down.push('Supabase 沒有正常回應，可能被暫停');

  if (i.repo?.deployment && (i.repo.deployment.state === 'FAILURE' || i.repo.deployment.state === 'ERROR'))
    warn.push('最近一次部署失敗');
  if (i.repo?.checks === 'FAILURE' || i.repo?.checks === 'ERROR') warn.push('最新 commit 的檢查沒過');
  if (i.latestHttp?.ok && i.latestHttp.ms !== null && i.latestHttp.ms > SLOW_MS)
    warn.push(`回應偏慢（${(i.latestHttp.ms / 1000).toFixed(1)} 秒）`);
  if (i.latestHttp?.ok && i.uptime24h !== null && i.uptime24h < 1) warn.push('過去 24 小時內曾經打不開');
  if (i.domain?.expires) {
    const days = Math.floor((Date.parse(i.domain.expires) - i.now) / DAY);
    if (days < DOMAIN_WARN_DAYS) warn.push(`網域 ${days} 天後到期`);
  }

  let health: Health;
  if (down.length) health = 'down';
  else if (warn.length) health = 'warn';
  else if (!i.config.url || !i.latestHttp) health = 'unknown';
  else health = 'ok';

  const reasons = [...down, ...warn];
  if (!i.config.url) reasons.push('還沒設定網址');
  else if (!i.latestHttp) reasons.push('還沒有檢查紀錄');

  const pushed = i.repo?.pushedAt ? Date.parse(i.repo.pushedAt) : null;
  const stale = pushed !== null && i.now - pushed > STALE_DAYS * DAY;

  return {
    config: i.config,
    health,
    reasons,
    stale,
    http: { latest: i.latestHttp, uptime24h: i.uptime24h, uptime7d: i.uptime7d, recent: i.recent },
    supabase: i.supabase,
    repo: i.repo,
    domain: i.domain,
    mutedUntil: null,
  };
}

const ORDER: Record<Health, number> = { down: 0, warn: 1, ok: 2, unknown: 3 };

/** 異常的排前面、未設定的排最後，同燈號照登記順序。 */
export function sortByHealth(list: ProjectView[]): ProjectView[] {
  return list
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => ORDER[a.p.health] - ORDER[b.p.health] || a.idx - b.idx)
    .map((x) => x.p);
}
