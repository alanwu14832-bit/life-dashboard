import type { ProjectView } from '../../../shared/types';
import { ago, ms } from '../../lib/format';
import { OWNER } from './labels';
import { Ticks } from './Ticks';

/** 正常的平台縮成一行：名稱、24 小時紀錄條、回應時間、最後 commit、待辦數。點一下展開。 */
export function ProjectRow({ p, now, openTasks, onExpand }: { p: ProjectView; now: number; openTasks: number; onExpand: () => void }) {
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
        <a href={`#p-${config.id}`}>詳細</a>
      </nav>
    </div>
  );
}
