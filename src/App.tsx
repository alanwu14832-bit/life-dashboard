import { useCallback, useEffect, useState } from 'react';
import type { Health, Overview, ProjectView, Today } from '../shared/types';
import { ago, clock, hostLabel, ms, pct, today } from './format';
import { clearCache, fetchWithTimeout, readCache, writeCache } from './cache';
import { Settings } from './Settings';
import { TodayPanel } from './Today';

/** 用網址 # 切換頁面：#settings 是設定頁，其他都是控制台 */
function useView(): 'dashboard' | 'settings' {
  const read = (): 'dashboard' | 'settings' => (location.hash === '#settings' ? 'settings' : 'dashboard');
  const [view, setView] = useState(read);
  useEffect(() => {
    const on = () => setView(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return view;
}

const POLL_MS = 5 * 60_000;
const OWNER = 'alanwu14832-bit';

const HEALTH_LABEL: Record<Health, string> = { down: '異常', warn: '注意', unknown: '未設定', ok: '正常' };

export function App() {
  // 先用上一次的資料把畫面畫出來，再到背景更新
  const [data, setData] = useState<Overview | null>(() => readCache<Overview>('overview')?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [todayData, setTodayData] = useState<Today | null>(() => readCache<Today>('today')?.data ?? null);
  const [refreshing, setRefreshing] = useState(true);
  const view = useView();

  const loadToday = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/today');
      if (res.status === 401) return location.reload();
      if (res.ok) {
        const body = (await res.json()) as Today;
        setTodayData(body);
        writeCache('today', body);
      }
    } catch {
      // 今天區塊讀不到時保留上一次的內容
    }
  }, []);

  // 勾選完成：寫回 Notion 成功後才從清單拿掉
  const completeTask = useCallback(async (id: string) => {
    const res = await fetch(`/api/tasks/${id}/complete`, { method: 'POST' });
    if (res.status === 401) return location.reload();
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    setTodayData((t) => {
      if (!t?.tasks.data) return t;
      const task = t.tasks.data.find((x) => x.id === id);
      const counts = { ...(t.platformTasks.data ?? {}) };
      if (task?.platform && counts[task.platform]) counts[task.platform] -= 1;
      const next: Today = {
        ...t,
        tasks: { ...t.tasks, data: t.tasks.data.filter((x) => x.id !== id) },
        platformTasks: t.platformTasks.data ? { ...t.platformTasks, data: counts } : t.platformTasks,
      };
      writeCache('today', next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/overview');
      if (res.status === 401) return location.reload(); // 登入過期，重新整理會出現登入頁
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Overview);
      writeCache('overview', body);
      setError(null);
    } catch (err) {
      setError(`讀不到監控資料：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([load(), loadToday()]).then(() => setRefreshing(false));
    const poll = setInterval(() => {
      load();
      loadToday();
    }, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load, loadToday]);

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await fetchWithTimeout('/api/run', { method: 'POST' }, 60_000);
      if (res.status === 401) return location.reload();
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body as Overview);
      writeCache('overview', body);
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
                {refreshing && <span className="refreshing"> · 更新中…</span>}
              </>
            ) : (
              '還沒有檢查紀錄'
            )}
          </span>
          <a className="btn-quiet nav-link" href={view === 'settings' ? '#' : '#settings'}>
            {view === 'settings' ? '回控制台' : '設定'}
          </a>
          <button type="button" className="btn" onClick={runNow} disabled={running}>
            {running ? '檢查中…' : '立即檢查'}
          </button>
          <form method="post" action="/logout" onSubmit={clearCache}>
            <button type="submit" className="btn-quiet">
              登出
            </button>
          </form>
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

      {view === 'settings' ? (
        <Settings onChanged={load} />
      ) : (
        <>
        <Summary data={data} today={todayData} counts={counts} now={now} />

        <div className="layout">
          <TodayPanel today={todayData} now={now} onTaskDone={completeTask} />

          <main className="platforms" aria-label="平台">
            {!data && !error && <p className="loading">讀取中…</p>}
            {data && <Platforms projects={data.projects} now={now} taskCounts={todayData?.platformTasks.data ?? {}} />}
          </main>
        </div>
        </>
      )}

      <footer className="foot">
        每 30 分鐘自動檢查一次，資料保留 30 天。新增或修改平台：右上角「設定」。
      </footer>
    </div>
  );
}

/** 一句話總結：平台狀況、今天到期幾件、下一個行程。 */
function Summary({ data, today, counts, now }: { data: Overview | null; today: Today | null; counts: Record<Health, number>; now: number }) {
  if (!data) return null;
  const total = data.projects.length;
  const issues = counts.down + counts.warn;
  const dueToday = today?.tasks.data?.filter((t) => t.bucket !== 'soon').length ?? null;
  const overdue = today?.tasks.data?.filter((t) => t.bucket === 'overdue').length ?? 0;
  const next = today?.calendar.data?.find((e) => !e.allDay && Date.parse(e.end) > now);
  const nextToday = next && new Date(next.start).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }) === today?.date;

  return (
    <section className="summary-line" aria-label="總覽">
      <span className={`seg ${counts.down ? 't-down' : issues ? 't-warn' : 't-ok'}`}>
        <span className="seg-dot" aria-hidden="true" />
        {counts.down
          ? `${counts.down} 個平台異常`
          : counts.warn
            ? `${counts.warn} 個平台要注意`
            : `${total - counts.unknown} 個平台都正常`}
      </span>
      {dueToday !== null && (
        <span className={`seg ${overdue ? 't-warn' : ''}`}>
          {dueToday - overdue > 0 ? `今天 ${dueToday - overdue} 件到期` : '今天沒有到期的待辦'}
          {overdue > 0 && `，${overdue} 件逾期`}
        </span>
      )}
      {today?.calendar.data && (
        <span className="seg">
          {next && nextToday
            ? `下一個行程 ${clock(Date.parse(next.start))} ${next.title}`
            : '今天沒有其他行程'}
        </span>
      )}
    </section>
  );
}

function Platforms({ projects, now, taskCounts }: { projects: ProjectView[]; now: number; taskCounts: Record<string, number> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const attention = projects.filter((p) => p.health === 'down' || p.health === 'warn');
  const rest = projects.filter((p) => p.health !== 'down' && p.health !== 'warn');
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <>
      {attention.length > 0 && (
        <section className="plat-section" aria-label="需要處理">
          <h2 className="section-title">需要處理</h2>
          <div className="projects">
            {attention.map((p) => (
              <ProjectCard key={p.config.id} p={p} now={now} openTasks={taskCounts[p.config.name] ?? 0} />
            ))}
          </div>
        </section>
      )}
      <section className="plat-section" aria-label="平台">
        <h2 className="section-title">{attention.length ? '其他平台' : '平台'}</h2>
        <ul className="rows">
          {rest.map((p) => (
            <li key={p.config.id}>
              {open[p.config.id] ? (
                <div className="row-open">
                  <ProjectCard p={p} now={now} openTasks={taskCounts[p.config.name] ?? 0} onCollapse={() => toggle(p.config.id)} />
                </div>
              ) : (
                <ProjectRow p={p} now={now} openTasks={taskCounts[p.config.name] ?? 0} onExpand={() => toggle(p.config.id)} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** 正常的平台縮成一行：名稱、24 小時紀錄條、回應時間、最後 commit、待辦數。點一下展開。 */
function ProjectRow({ p, now, openTasks, onExpand }: { p: ProjectView; now: number; openTasks: number; onExpand: () => void }) {
  const { config, repo } = p;
  const latest = p.http.latest;
  return (
    <div className={`row h-${p.health}`}>
      <button type="button" className="row-main" onClick={onExpand} aria-expanded="false" aria-label={`展開 ${config.name} 的詳細資料`}>
        <span className="row-dot" aria-hidden="true" />
        <span className="row-name">
          <span className="row-title">{config.name}</span>
          <span className="row-summary">{config.summary}</span>
        </span>
        {config.url ? <Ticks recent={p.http.recent} now={now} compact /> : <span className="row-note">{p.reasons[0]}</span>}
        <span className="row-stat num">{latest?.ok ? ms(latest.ms) : '—'}</span>
        <span className="row-stat row-commit">{repo?.commit ? ago(repo.commit.date, now) : '—'}</span>
        <span className="row-chips">
          {openTasks > 0 && <span className="chip chip-tasks">{openTasks} 件待辦</span>}
          {p.stale && <span className="chip chip-stale">停滯</span>}
        </span>
      </button>
      <nav className="row-links" aria-label={`${config.name} 連結`}>
        {config.url && (
          <a href={config.url} target="_blank" rel="noreferrer">
            網站
          </a>
        )}
        <a href={`https://github.com/${OWNER}/${config.repo}`} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </div>
  );
}

function ProjectCard({ p, now, openTasks, onCollapse }: { p: ProjectView; now: number; openTasks: number; onCollapse?: () => void }) {
  const { config, repo } = p;
  const latest = p.http.latest;
  return (
    <article className={`card h-${p.health}`}>
      <div className="card-head">
        <div className="card-name">
          <h3>{config.name}</h3>
          <span className="card-summary">{config.summary}</span>
        </div>
        <div className="card-head-right">
          <span className="pill">{HEALTH_LABEL[p.health]}</span>
          {onCollapse && (
            <button type="button" className="btn-quiet btn-small" onClick={onCollapse} aria-label={`收起 ${config.name}`}>
              收起
            </button>
          )}
        </div>
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
          {openTasks > 0 && <span className="chip chip-tasks">{openTasks} 件待辦</span>}
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
function Ticks({ recent, now, compact = false }: { recent: ProjectView['http']['recent']; now: number; compact?: boolean }) {
  const slots: ('ok' | 'down' | 'none')[] = Array(SLOTS).fill('none');
  for (const r of recent) {
    const idx = SLOTS - 1 - Math.floor((now - r.ts) / SLOT_MS);
    if (idx < 0 || idx >= SLOTS) continue;
    if (slots[idx] !== 'down') slots[idx] = r.ok ? 'ok' : 'down';
  }
  const downs = slots.filter((s) => s === 'down').length;
  return (
    <div className={compact ? 'ticks-wrap is-compact' : 'ticks-wrap'}>
      <div className="ticks" role="img" aria-label={`最近 24 小時：${downs ? `${downs} 次打不開` : '沒有打不開的紀錄'}`}>
        {slots.map((s, i) => (
          <span key={i} className={`tick tick-${s}`} />
        ))}
      </div>
      {!compact && (
        <div className="ticks-axis">
          <span>24 小時前</span>
          <span>現在</span>
        </div>
      )}
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
