import { useState } from 'react';
import type { ProjectHistory } from '../../../shared/types';
import { pct } from '../../lib/format';

/** 每天一根，高度是可用率；100% 用狀態綠，有掉過的用警示色，沒有紀錄的留灰。 */
export function UptimeBars({ days }: { days: ProjectHistory['days'] }) {
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
