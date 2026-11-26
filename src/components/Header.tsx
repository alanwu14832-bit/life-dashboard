import type { Overview } from '../../shared/types';
import { clearCache } from '../lib/cache';
import { ago, clock, today } from '../lib/format';

interface Props {
  overview: Overview | null;
  now: number;
  onDashboard: boolean;
  refreshing: boolean;
  running: boolean;
  onRunNow: () => void;
}

export function Header({ overview, now, onDashboard, refreshing, running, onRunNow }: Props) {
  return (
    <header className="top">
      <div className="top-title">
        <h1>
          <a href="#" className="home-link">
            專案控制台
          </a>
        </h1>
        <span className="top-date">{today(now)}</span>
      </div>
      <div className="top-actions">
        <span className="top-meta" aria-live="polite">
          {overview?.lastRun ? (
            <>
              上次檢查 <time className="num">{clock(overview.lastRun.ts)}</time>（{ago(overview.lastRun.ts, now)}）
              {refreshing && <span className="refreshing"> · 更新中…</span>}
            </>
          ) : refreshing ? (
            '讀取中…'
          ) : (
            '還沒有檢查紀錄'
          )}
        </span>
        <a className="btn-quiet nav-link" href={onDashboard ? '#settings' : '#'}>
          {onDashboard ? '設定' : '回控制台'}
        </a>
        <button type="button" className="btn" onClick={onRunNow} disabled={running}>
          {running ? '檢查中…' : '立即檢查'}
        </button>
        <form method="post" action="/logout" onSubmit={clearCache}>
          <button type="submit" className="btn-quiet">
            登出
          </button>
        </form>
      </div>
    </header>
  );
}
