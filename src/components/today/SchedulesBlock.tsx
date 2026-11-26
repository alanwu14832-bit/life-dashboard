import type { Today } from '../../../shared/types';
import { Problem } from './Problem';
import { dayLabel } from './util';

export function SchedulesBlock({ today }: { today: Today }) {
  const { schedules } = today;
  return (
    <section className="block">
      <div className="block-head">
        <h3>排程</h3>
      </div>
      {!schedules.data ? (
        <Problem error={schedules.error ?? '讀不到排程'} />
      ) : (
        <ul className="schedules">
          {schedules.data.map((s) => (
            <li key={s.name} className={`s-${s.state}`}>
              <span className="dot" aria-hidden="true" />
              <span className="sch-body">
                <span className="sch-name">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </span>
                <span className="sch-note">
                  {s.note}
                  {s.state !== 'ok' && s.latestDate && <>（最新一筆 {dayLabel(s.latestDate)}）</>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
