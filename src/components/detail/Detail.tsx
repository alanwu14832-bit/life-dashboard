import { useEffect, useState } from 'react';
import type { ProjectHistory, ProjectView } from '../../../shared/types';
import { fetchWithTimeout } from '../../lib/cache';
import { pct } from '../../lib/format';
import { LatencyChart } from './LatencyChart';
import { MuteControl } from './MuteControl';
import { QuickLinks } from './QuickLinks';
import { UptimeBars } from './UptimeBars';
import { span, when } from './util';

export function Detail({ id, project, now, onChanged }: { id: string; project: ProjectView | undefined; now: number; onChanged: () => void }) {
  const [hist, setHist] = useState<ProjectHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHist(null);
    fetchWithTimeout(`/api/projects/${id}/history`)
      .then(async (res) => {
        if (res.status === 401) return location.reload();
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setHist(body as ProjectHistory);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  const name = project?.config.name ?? id;

  return (
    <main className="detail" aria-label={`${name} 詳細資料`}>
      <a className="back" href="#">
        ← 回控制台
      </a>
      <div className="detail-head">
        <div>
          <h2>{name}</h2>
          {project && <p className="detail-sub">{project.config.summary}</p>}
        </div>
      </div>
      {project && <QuickLinks c={project.config} />}
      {project && <MuteControl id={project.config.id} mutedUntil={project.mutedUntil} onChanged={onChanged} />}

      {error && <p className="banner banner-down">{error}</p>}
      {!hist && !error && <p className="loading">讀取中…</p>}

      {hist && (
        <>
          <section className="detail-block">
            <div className="detail-block-head">
              <h3>30 天可用率</h3>
              <span className="detail-big num">{pct(hist.uptime30d)}</span>
            </div>
            <UptimeBars days={hist.days} />
          </section>

          <section className="detail-block">
            <div className="detail-block-head">
              <h3>7 天回應時間</h3>
              <span className="detail-note">每小時平均，只算打得開的那幾次</span>
            </div>
            <LatencyChart points={hist.latency} now={now} />
          </section>

          <section className="detail-block">
            <div className="detail-block-head">
              <h3>異常紀錄</h3>
              <span className="detail-note">保留 90 天</span>
            </div>
            {hist.incidents.length === 0 ? (
              <p className="empty">沒有異常紀錄</p>
            ) : (
              <ul className="incidents">
                {hist.incidents.map((i) => (
                  <li key={`${i.label}-${i.openedAt}`} className={i.closedAt ? '' : 'is-open'}>
                    <span className="inc-state">{i.closedAt ? '已恢復' : '進行中'}</span>
                    <span className="inc-body">
                      <span className="inc-label">
                        {i.label}
                        {i.detail ? `：${i.detail}` : ''}
                      </span>
                      <span className="inc-time num">
                        {when(i.openedAt)} 起 · {i.closedAt ? `中斷 ${span(i.closedAt - i.openedAt)}` : `已經 ${span(now - i.openedAt)}`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
