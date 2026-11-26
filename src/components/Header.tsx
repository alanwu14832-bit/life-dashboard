import type { Overview } from '../../shared/types';
import { clearCache } from '../lib/cache';
import { ago, clock } from '../lib/format';

interface Props {
  overview: Overview | null;
  now: number;
  onDashboard: boolean;
  refreshing: boolean;
  running: boolean;
  onRunNow: () => void;
}

/** 刊頭上方的細列：站名、上次檢查、三個文字按鈕。 */
export function Header({ overview, now, onDashboard, refreshing, running, onRunNow }: Props) {
  return (
    <header className="top">
      <div className="top-left">
        <h1 className="brand">
          <a href="#">專案控制台</a>
        </h1>
        <span className="top-meta" aria-live="polite">
          {overview?.lastRun ? (
            <>
              上次檢查 <time className="num">{clock(overview.lastRun.ts)}</time>（{ago(overview.lastRun.ts, now)}）
              {refreshing && <span className="refreshing">更新中…</span>}
            </>
          ) : refreshing ? (
            '讀取中…'
          ) : (
            '還沒有檢查紀錄'
          )}
        </span>
      </div>
      <nav className="top-actions" aria-label="操作">
        <button type="button" className="text-btn" onClick={onRunNow} disabled={running}>
          {running ? '檢查中…' : '立即檢查'}
        </button>
        {!onDashboard && (
          <a className="text-btn" href="#">
            回控制台
          </a>
        )}
        <a className="text-btn" href="#week">
          週報
        </a>
        <a className="text-btn" href="#settings">
          設定
        </a>
        <form method="post" action="/logout" onSubmit={clearCache}>
          <button type="submit" className="text-btn is-quiet">
            登出
          </button>
        </form>
      </nav>
    </header>
  );
}
