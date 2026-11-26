import type { Overview, Today } from '../../../shared/types';
import { buildLede } from './lede';

const dateLine = (now: number) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(now))
    .replace(/(\d+)月(\d+)日/, '$1 月 $2 日 ');

/** 刊頭：大大的日期，加一段完整句子的總結。 */
export function Masthead({ overview, today, now }: { overview: Overview | null; today: Today | null; now: number }) {
  const parts = buildLede(overview, today, now);
  return (
    <header className="mast">
      <h2 className="mast-date">{dateLine(now)}</h2>
      {parts.length > 0 ? (
        <p className="mast-lede">
          {parts.map((p, i) => (
            <span key={i} className={p.tone ? `t-${p.tone}` : undefined}>
              {p.text}
            </span>
          ))}
        </p>
      ) : (
        <p className="mast-lede is-loading">正在整理今天的狀況…</p>
      )}
    </header>
  );
}
