import type { Overview, ScheduleStatus, Today } from '../../../shared/types';
import { buildLede } from './lede';

const dateLine = (now: number) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' })
    .format(new Date(now))
    .replace(/(\d+)月(\d+)日/, '$1 月 $2 日 ');

/** 刊頭：大日期、天氣、一段完整句子的總結，再加上晨間簡報與台股收盤的重點。 */
export function Masthead({ overview, today, now }: { overview: Overview | null; today: Today | null; now: number }) {
  const parts = buildLede(overview, today, now);
  const w = today?.weather.data;
  const sch = today?.schedules.data ?? [];
  const brief = sch.find((s) => s.name === '晨間簡報');
  const tw = sch.find((s) => s.name === '台股收盤');
  return (
    <header className="mast">
      <div className="mast-row">
        <h2 className="mast-date">{dateLine(now)}</h2>
        {w && (
          <p className="mast-weather" aria-label={`${w.place}天氣`}>
            <span className="num">{w.now}°</span>
            <span>
              {w.place} {w.label} · {w.low}–{w.high}°{w.rain !== null && ` · 降雨 ${w.rain}%`}
            </span>
          </p>
        )}
      </div>
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
      {(brief?.headline || tw?.figure) && (
        <dl className="mast-market">
          {brief?.headline && <MarketItem label="今日焦點" s={brief} text={brief.headline} today={today?.date} />}
          {tw?.figure && <MarketItem label="台股收盤" s={tw} text={tw.figure} today={today?.date} dir={tw.direction} />}
        </dl>
      )}
    </header>
  );
}

function MarketItem({ label, s, text, today, dir }: { label: string; s: ScheduleStatus; text: string; today?: string; dir?: ScheduleStatus['direction'] }) {
  const stale = s.latestDate && today && s.latestDate !== today;
  return (
    <div className="mkt">
      <dt>
        {label}
        {stale && <span className="mkt-date">（{Number(s.latestDate!.slice(5, 7))}/{Number(s.latestDate!.slice(8, 10))}）</span>}
      </dt>
      <dd>
        {s.url ? (
          <a href={s.url} target="_blank" rel="noreferrer" className={dir ? `dir-${dir}` : undefined}>
            {dir === 'up' ? '▲ ' : dir === 'down' ? '▼ ' : ''}
            {text}
          </a>
        ) : (
          text
        )}
      </dd>
    </div>
  );
}
