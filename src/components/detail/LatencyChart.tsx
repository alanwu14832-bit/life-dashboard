import { useMemo, useRef, useState } from 'react';
import type { ProjectHistory } from '../../../shared/types';
import { ms } from '../../lib/format';
import { dt, TZ } from './util';

const W = 720;
const H = 200;
const PAD = { l: 48, r: 12, t: 12, b: 26 };

/** 回應時間折線：一條線、淡格線、最新一點加粗；滑過出現十字線與數值。 */
export function LatencyChart({ points, now }: { points: ProjectHistory['latency']; now: number }) {
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
