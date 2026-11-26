import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectHistory, ProjectView } from '../shared/types';
import { fetchWithTimeout } from './cache';
import { ms, pct } from './format';

const TZ = 'Asia/Taipei';
const dt = (t: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, ...opts }).format(new Date(t));
const when = (t: number) => dt(t, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

function span(msLen: number): string {
  const m = Math.max(1, Math.round(msLen / 60_000));
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`;
}

export function Detail({ id, project, now }: { id: string; project: ProjectView | undefined; now: number }) {
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
        {project?.config.url && (
          <a className="btn-quiet" href={project.config.url} target="_blank" rel="noreferrer">
            開啟網站
          </a>
        )}
      </div>

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

/** 每天一根，高度是可用率；100% 用狀態綠，有掉過的用警示色，沒有紀錄的留灰。 */
function UptimeBars({ days }: { days: ProjectHistory['days'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const label = (d: ProjectHistory['days'][number]) =>
    `${d.date.slice(5).replace('-', '/')}：${d.uptime === null ? '沒有紀錄' : `${pct(d.uptime)}（${d.checks} 次檢查）`}`;
  return (
    <div className="ubars-wrap">
      <div className="ubars" role="list" aria-label="最近 30 天每天的可用率">
        {days.map((d, i) => {
          // 低於 90% 的都畫到底，讓「有掉過」和「掉很多」分得出來但不誇張
          const h = d.uptime === null ? 100 : 12 + Math.max(0, (d.uptime - 0.9) / 0.1) * 88;
          const tone = d.uptime === null ? 'none' : d.uptime >= 1 ? 'ok' : d.uptime >= 0.99 ? 'warn' : 'down';
          return (
            <div
              key={d.date}
              role="listitem"
              aria-label={label(d)}
              tabIndex={0}
              className={`ubar-slot${hover === i ? ' is-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className={`ubar ubar-${tone}`} style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="ubars-axis">
        <span>{days[0]?.date.slice(5).replace('-', '/')}</span>
        <span className="ubars-tip" aria-live="polite">
          {hover !== null ? label(days[hover]) : '游標移到柱子上看當天數字'}
        </span>
        <span>今天</span>
      </div>
    </div>
  );
}

const W = 720;
const H = 200;
const PAD = { l: 48, r: 12, t: 12, b: 26 };

/** 回應時間折線：一條線、淡格線、最新一點加粗；滑過出現十字線與數值。 */
function LatencyChart({ points, now }: { points: ProjectHistory['latency']; now: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const values = points.map((p) => p.ms).filter((v): v is number => v !== null);

  const { yMax, ticks } = useMemo(() => {
    const max = Math.max(200, ...values);
    const step = max <= 500 ? 100 : max <= 1000 ? 250 : max <= 2500 ? 500 : max <= 5000 ? 1000 : 2500;
    const top = Math.ceil(max / step) * step;
    return { yMax: top, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
  }, [values]);

  if (!values.length) return <p className="empty">這 7 天還沒有回應時間紀錄</p>;

  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts;
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);

  // 沒有資料的小時斷開，不硬連起來
  const segments: string[] = [];
  let cur = '';
  points.forEach((p) => {
    if (p.ms === null) {
      if (cur) segments.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(p.ms).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  const lastIdx = points.map((p) => p.ms !== null).lastIndexOf(true);
  const days = Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now - (7 - i) * 86_400_000);
    return Date.parse(`${d.toLocaleDateString('en-CA', { timeZone: TZ })}T00:00:00+08:00`);
  }).filter((t) => t >= t0 && t <= t1);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const ratio = (px - PAD.l) / (W - PAD.l - PAD.r);
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="lchart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`最近 7 天每小時平均回應時間，最新 ${ms(points[lastIdx]?.ms)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="lc-grid" />
            <text x={PAD.l - 8} y={y(t)} className="lc-label" textAnchor="end" dominantBaseline="middle">
              {t >= 1000 ? `${t / 1000}s` : `${t}`}
            </text>
          </g>
        ))}
        {days.map((t) => (
          <text key={t} x={x(t)} y={H - 8} className="lc-label" textAnchor="middle">
            {dt(t, { month: 'numeric', day: 'numeric' })}
          </text>
        ))}
        {points.map((p) =>
          p.down ? <rect key={p.ts} x={x(p.ts) - 2} y={PAD.t} width={4} height={H - PAD.t - PAD.b} className="lc-down" /> : null,
        )}
        {segments.map((d, i) => (
          <path key={i} d={d} className="lc-line" />
        ))}
        {lastIdx >= 0 && <circle cx={x(points[lastIdx].ts)} cy={y(points[lastIdx].ms!)} r={4} className="lc-dot" />}
        {hp && (
          <g>
            <line x1={x(hp.ts)} x2={x(hp.ts)} y1={PAD.t} y2={H - PAD.b} className="lc-cross" />
            {hp.ms !== null && <circle cx={x(hp.ts)} cy={y(hp.ms)} r={4} className="lc-dot" />}
          </g>
        )}
      </svg>
      <p className="lc-tip num" aria-live="polite">
        {hp
          ? `${dt(hp.ts, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}：${hp.ms === null ? '沒有紀錄' : ms(hp.ms)}${hp.down ? '，這小時曾經打不開' : ''}`
          : `最新 ${ms(points[lastIdx]?.ms)} · 紅色直條代表那個小時曾經打不開`}
      </p>
    </div>
  );
}
