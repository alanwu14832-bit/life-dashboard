import { useEffect, useState } from 'react';
import type { Weekly as WeeklyData } from '../../../shared/types';
import { fetchWithTimeout } from '../../lib/cache';
import { pct } from '../../lib/format';
import { ErrorState } from '../States';

const md = (ymd: string) => `${Number(ymd.slice(5, 7))} 月 ${Number(ymd.slice(8, 10))} 日`;

/** 每週回顧：同一份內容也會在週日晚上 9 點寄到信箱。 */
export function Weekly() {
  const [w, setW] = useState<WeeklyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fetchWithTimeout('/api/weekly', {}, 30_000)
      .then(async (res) => {
        if (res.status === 401) return location.reload();
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setW(body as WeeklyData);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, []);

  return (
    <main className="brief" aria-label="每週回顧">
      <header className="mast">
        <h2 className="mast-date">這一週</h2>
        <p className="mast-lede">
          {w ? (
            <>
              {md(w.from)}到{md(w.to)}，完成 {w.done.data?.length ?? 0} 件待辦、寫了 {w.notes.data?.length ?? 0} 篇筆記，平台合計{' '}
              {w.platforms.reduce((a, p) => a + (p.commits ?? 0), 0)} 次 commit
              {w.platforms.some((p) => p.incidents) ? `，異常 ${w.platforms.reduce((a, p) => a + p.incidents, 0)} 次` : '，沒有異常'}。
            </>
          ) : (
            '正在整理這一週…'
          )}
        </p>
      </header>

      {error && <ErrorState message={`讀不到週報：${error}`} onRetry={load} />}

      {w && (
        <>
          <section className="sec" aria-labelledby="wk-done">
            <h2 id="wk-done" className="sec-title">完成的待辦</h2>
            {w.done.error && <p className="sec-problem">{w.done.error}</p>}
            {w.done.data?.length === 0 && <p className="sec-empty">這週沒有標成完成的待辦。</p>}
            <ul className="lines">
              {w.done.data?.map((d) => (
                <li key={d.url} className="line">
                  <span className="line-time">{`${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`}</span>
                  <div className="line-body">
                    <div className="line-text">
                      <a className="line-title" href={d.url} target="_blank" rel="noreferrer">
                        {d.title}
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="sec" aria-labelledby="wk-plat">
            <h2 id="wk-plat" className="sec-title">平台這一週</h2>
            <ul className="plats">
              {w.platforms.map((p) => (
                <li key={p.id}>
                  <a className={`plat wk ${p.incidents ? 'h-warn' : 'h-ok'}`} href={`#p-${p.id}`}>
                    <span className="plat-name">
                      <span className="plat-title">{p.name}</span>
                      <span className="plat-state">{p.incidents ? `異常 ${p.incidents} 次` : '沒有異常'}</span>
                    </span>
                    <span className="plat-ms num">{p.commits ?? '—'} commit</span>
                    <span className="plat-ms num">{pct(p.uptime)}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <div className="two">
            <section className="sec" aria-labelledby="wk-notes">
              <h2 id="wk-notes" className="sec-title">新筆記</h2>
              {w.notes.error && <p className="sec-problem">{w.notes.error}</p>}
              {w.notes.data?.length === 0 && <p className="sec-empty">這週沒有新筆記。</p>}
              {w.notes.data?.map((n) => (
                <div key={n.url} className="mini">
                  <a className="mini-title" href={n.url} target="_blank" rel="noreferrer">
                    {n.title}
                  </a>
                </div>
              ))}
            </section>
            <section className="sec" aria-labelledby="wk-next">
              <h2 id="wk-next" className="sec-title">下週</h2>
              {w.nextWeek.data ? (
                <div className="mini">
                  <span className="mini-title">
                    {w.nextWeek.data.events} 個行程、{w.nextWeek.data.tasks} 件待辦到期
                  </span>
                  <span className="mini-meta">明天起 7 天</span>
                </div>
              ) : (
                <p className="sec-problem">{w.nextWeek.error}</p>
              )}
            </section>
          </div>
          <p className="sec-empty">這份週報每週日晚上 9 點也會寄到你的信箱。</p>
        </>
      )}
    </main>
  );
}
