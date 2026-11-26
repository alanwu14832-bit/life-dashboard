import type { Today } from '../../../shared/types';
import { ago } from '../../lib/format';
import { dayLabel } from './time';

/** 排程與知識庫並排的兩小段。 */
export function SideNotes({ today, now }: { today: Today; now: number }) {
  const { schedules, knowledge } = today;
  return (
    <div className="two">
      <section className="sec" aria-labelledby="sec-sch">
        <h2 id="sec-sch" className="sec-title">排程</h2>
        {!schedules.data ? (
          <p className="sec-problem">{schedules.error}</p>
        ) : (
          schedules.data.map((s) => (
            <div key={s.name} className="mini">
              {s.url ? (
                <a className="mini-title" href={s.url} target="_blank" rel="noreferrer">
                  {s.name}
                </a>
              ) : (
                <span className="mini-title">{s.name}</span>
              )}
              <span className={`mini-meta s-${s.state}`}>
                {s.note}
                {s.state !== 'ok' && s.latestDate && `（最新一筆 ${dayLabel(s.latestDate)}）`}
              </span>
            </div>
          ))
        )}
      </section>
      <section className="sec" aria-labelledby="sec-notes">
        <h2 id="sec-notes" className="sec-title">知識庫 · 最近 7 天</h2>
        {!knowledge.data ? (
          <p className="sec-problem">{knowledge.error}</p>
        ) : knowledge.data.length === 0 ? (
          <p className="sec-empty">這 7 天沒有新筆記</p>
        ) : (
          knowledge.data.map((k) => (
            <div key={k.url} className="mini">
              <a className="mini-title" href={k.url} target="_blank" rel="noreferrer">
                {k.title}
              </a>
              <span className="mini-meta">{[k.topic, ago(k.created, now)].filter(Boolean).join(' · ')}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
