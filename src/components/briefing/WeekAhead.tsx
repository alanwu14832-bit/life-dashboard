import type { Today } from '../../../shared/types';
import type { ReactNode } from 'react';
import { addDays, dayParts, hm, onDay } from './time';
import { TaskLine } from './TodayTimeline';

/** 這週接下來：明天起 6 天的行程，加上 7 天內到期的待辦，依日期排。 */
export function WeekAhead({ today, onTaskDone }: { today: Today; onTaskDone: (id: string) => Promise<void> }) {
  const days = Array.from({ length: 6 }, (_, i) => addDays(today.date, i + 1));
  const soon = (today.tasks.data ?? []).filter((t) => t.bucket === 'soon');
  const groups = days
    .map((d) => ({
      d,
      events: today.calendar.data ? onDay(today.calendar.data, d).filter((e) => !e.allDay || e.start === d) : [],
      tasks: soon.filter((t) => t.due?.slice(0, 10) === d),
    }))
    .filter((g) => g.events.length || g.tasks.length);

  if (!groups.length) return null;
  return (
    <section className="sec" aria-labelledby="sec-week">
      <h2 id="sec-week" className="sec-title">這週接下來</h2>
      <ul className="lines">
        {groups.flatMap((g) => [
          ...g.events.map((e, i) => (
            <li key={`${g.d}-e${i}`} className="line">
              <span className="line-time">{i === 0 ? dateCell(g.d) : ''}</span>
              <div className="line-body">
                <div className="line-text">
                  <span className="line-title">{e.title}</span>
                  <span className="line-meta">{[e.allDay ? '整天' : `${hm(e.start)}–${hm(e.end)}`, e.location].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
            </li>
          )),
          ...g.tasks.map((t, i) => (
            <TaskLine key={t.id} task={t} label={g.events.length === 0 && i === 0 ? dateCell(g.d) : ''} onDone={onTaskDone} />
          )),
        ])}
      </ul>
    </section>
  );
}

function dateCell(ymd: string): ReactNode {
  const { md, wd } = dayParts(ymd);
  return (
    <>
      {md}
      <small className="line-wd">{wd}</small>
    </>
  );
}
