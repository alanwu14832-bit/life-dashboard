import { useCallback, useEffect, useState } from 'react';
import type { Health, Overview, ProjectView } from '../shared/types';
import { ago, clock, hostLabel, ms, pct, today } from './format';

const POLL_MS = 5 * 60_000;
const OWNER = 'alanwu14832-bit';
const NOTION_HOME = 'https://app.notion.com/p/3c7cbee2351f817b8dbbec370a46a836';
const CALENDAR_DAY = 'https://calendar.google.com/calendar/r/day';

const HEALTH_LABEL: Record<Health, string> = { down: '異常', warn: '注意', unknown: '未設定', ok: '正常' };

export function App() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/overview');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Overview);
      setError(null);
    } catch (err) {
      setError(`讀不到監控資料：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/run', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const counts = { down: 0, warn: 0, unknown: 0, ok: 0 } as Record<Health, number>;
  data?.projects.forEach((p) => counts[p.health]++);
  const scheduleLate = data?.lastRun ? now - data.lastRun.ts > 75 * 60_000 : false;

  return (
    <div className="page">
      <header className="top">
        <div className="top-title">
          <h1>專案控制台</h1>
          <span className="top-date">{today(now)}</span>
        </div>
        <div className="top-actions">
          <span className="top-meta">
            {data?.lastRun ? (
              <>
                上次檢查 <time className="num">{clock(data.lastRun.ts)}</time>（{ago(data.lastRun.ts, now)}）
              </>
            ) : (
              '還沒有檢查紀錄'
            )}
          </span>
          <button type="button" className="btn" onClick={runNow} disabled={running}>
            {running ? '檢查中…' : '立即檢查'}
          </button>
        </div>
      </header>

      {error && (
        <p className="banner banner-down" role="alert">
          {error}
        </p>
      )}
      {scheduleLate && (
        <p className="banner banner-warn">自動檢查超過一小時沒跑了，Cloudflare 的排程可能停了。</p>
      )}
      {data?.github?.error && (
        <p className="banner banner-muted">GitHub 資料沒更新：{data.github.error}</p>
      )}

      <section className="summary" aria-label="總覽">
        {(['down', 'warn', 'ok', 'unknown'] as Health[]).map((h) => (
          <div key={h} className={`summary-item h-${h}${counts[h] === 0 ? ' is-zero' : ''}`}>
            <span className="summary-n num">{data ? counts[h] : '–'}</span>
            <span className="summary-label">{HEALTH_LABEL[h]}</span>
          </div>
        ))}
      </section>

      <div className="layout">
        <aside className="today" aria-label="今天">
          <h2>今天</h2>
          <p className="today-note">第二階段會在這裡列出今天的行程、到期待辦和排程狀態。在那之前先從這兩個入口看：</p>
          <ul className="today-links">
            <li>
              <a href={NOTION_HOME} target="_blank" rel="noreferrer">
                Notion 首頁<span>到期待辦、晨間簡報、台股收盤</span>
              </a>
            </li>
            <li>
              <a href={CALENDAR_DAY} target="_blank" rel="noreferrer">
                Google 行事曆<span>今天的課與行程</span>
              </a>
            </li>
          </ul>
        </aside>

        <main className="projects" aria-label="平台">
          <h2 className="sr-only">平台</h2>
          {!data && !error && <p className="loading">讀取中…</p>}
          {data?.projects.map((p) => <ProjectCard key={p.config.id} p={p} now={now} />)}
        </main>
      </div>

      <footer className="foot">
        每 30 分鐘自動檢查一次，資料保留 30 天。新增平台：編輯 repo 裡的 <code>projects.json</code>。
      </footer>
    </div>
  );
}

function ProjectCard({ p, now }: { p: ProjectView; now: number }) {
  const { config, repo } = p;
  const latest = p.http.latest;
  return (
    <article className={`card h-${p.health}`}>
      <div className="card-head">
        <div className="card-name">
          <h3>{config.name}</h3>
          <span className="card-summary">{config.summary}</span>
        </div>
        <span className="pill">{HEALTH_LABEL[p.health]}</span>
      </div>

      {p.reasons.length > 0 && (
        <ul className="reasons">
          {p.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {config.url && <Ticks recent={p.http.recent} now={now} />}

      <dl className="metrics">
        <Metric label="回應" value={latest ? (latest.ok ? ms(latest.ms) : latest.status ? `HTTP ${latest.status}` : '失敗') : '—'} />
        <Metric label="24 小時" value={pct(p.http.uptime24h)} />
        <Metric label="7 天" value={pct(p.http.uptime7d)} />
        <Metric
          label="Supabase"
          value={!config.supabase ? '不使用' : !p.supabase ? '—' : p.supabase.ok ? '正常' : '沒回應'}
          tone={p.supabase && !p.supabase.ok ? 'down' : undefined}
        />
        <Metric
          label="最後 commit"
          value={repo?.commit ? ago(repo.commit.date, now) : '—'}
          title={repo?.commit?.message}
        />
        <Metric label="部署" value={deployText(p, now)} tone={deployTone(p)} />
      </dl>

      {repo?.commit?.message && <p className="commit" title={repo.commit.message}>{repo.commit.message}</p>}

      <div className="card-foot">
        <div className="chips">
          <span className="chip">{hostLabel(config.host)}</span>
          {repo?.private && <span className="chip">私有</span>}
          {p.stale && <span className="chip chip-stale">停滯 30 天以上</span>}
          {repo && repo.openPRs > 0 && <span className="chip">{repo.openPRs} 個 PR 未合併</span>}
        </div>
        <nav className="links" aria-label={`${config.name} 連結`}>
          {config.url && (
            <a href={config.url} target="_blank" rel="noreferrer">
              網站
            </a>
          )}
          <a href={`https://github.com/${OWNER}/${config.repo}`} target="_blank" rel="noreferrer">
            GitHub
          </a>
          {config.notes && (
            <a href={config.notes} target="_blank" rel="noreferrer">
              筆記
            </a>
          )}
        </nav>
      </div>
    </article>
  );
}

function Metric({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: 'down' | 'warn' }) {
  return (
    <div className={`metric${tone ? ` t-${tone}` : ''}`} title={title}>
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

const SLOTS = 48;
const SLOT_MS = 30 * 60_000;

/** 最近 24 小時、每 30 分鐘一格。沒有紀錄的格子留空，不假裝是正常。 */
function Ticks({ recent, now }: { recent: ProjectView['http']['recent']; now: number }) {
  const slots: ('ok' | 'down' | 'none')[] = Array(SLOTS).fill('none');
  for (const r of recent) {
    const idx = SLOTS - 1 - Math.floor((now - r.ts) / SLOT_MS);
    if (idx < 0 || idx >= SLOTS) continue;
    if (slots[idx] !== 'down') slots[idx] = r.ok ? 'ok' : 'down';
  }
  const downs = slots.filter((s) => s === 'down').length;
  return (
    <div className="ticks-wrap">
      <div className="ticks" role="img" aria-label={`最近 24 小時：${downs ? `${downs} 次打不開` : '沒有打不開的紀錄'}`}>
        {slots.map((s, i) => (
          <span key={i} className={`tick tick-${s}`} />
        ))}
      </div>
      <div className="ticks-axis">
        <span>24 小時前</span>
        <span>現在</span>
      </div>
    </div>
  );
}

const DEPLOY_LABEL: Record<string, string> = {
  SUCCESS: '成功',
  ACTIVE: '成功',
  INACTIVE: '已被取代',
  FAILURE: '失敗',
  ERROR: '失敗',
  IN_PROGRESS: '進行中',
  QUEUED: '排隊中',
  PENDING: '等待中',
  WAITING: '等待中',
  DESTROYED: '已移除',
};

function deployText(p: ProjectView, now: number): string {
  const d = p.repo?.deployment;
  if (d) return `${DEPLOY_LABEL[d.state ?? ''] ?? '未知'} · ${ago(d.createdAt, now)}`;
  // 沒有 GitHub 部署紀錄的（例如用 GitHub Actions 跑 wrangler deploy），看最新 commit 的檢查結果
  const c = p.repo?.checks;
  if (c === 'SUCCESS') return '檢查通過';
  if (c === 'FAILURE' || c === 'ERROR') return '檢查失敗';
  if (c === 'PENDING' || c === 'EXPECTED') return '檢查中';
  return '—';
}

function deployTone(p: ProjectView): 'down' | 'warn' | undefined {
  const d = p.repo?.deployment?.state;
  if (d === 'FAILURE' || d === 'ERROR') return 'warn';
  if (!p.repo?.deployment && (p.repo?.checks === 'FAILURE' || p.repo?.checks === 'ERROR')) return 'warn';
  return undefined;
}
