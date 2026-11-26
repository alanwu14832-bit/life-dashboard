import type { ProjectView } from '../../../shared/types';
import { ago, hostLabel, ms, pct } from '../../lib/format';
import { deployText, deployTone, HEALTH_LABEL, OWNER } from './labels';
import { Ticks } from './Ticks';

export function ProjectCard({ p, now, openTasks, onCollapse }: { p: ProjectView; now: number; openTasks: number; onCollapse?: () => void }) {
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
          <a href={`#p-${config.id}`}>詳細</a>
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
