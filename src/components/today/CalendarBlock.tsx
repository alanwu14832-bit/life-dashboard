import type { CalendarEvent, Section } from '../../../shared/types';
import { Problem } from './Problem';
import { addDays, CALENDAR_DAY, dayLabel, taipeiYmd, time } from './util';

export function CalendarBlock({ section, date, now }: { section: Section<CalendarEvent[]>; date: string; now: number }) {
  const head = (
    <div className="block-head">
      <h3>行程</h3>
      <a href={CALENDAR_DAY} target="_blank" rel="noreferrer">
        行事曆
      </a>
    </div>
  );
  if (!section.data) return <section className="block">{head}<Problem error={section.error ?? '讀不到行事曆'} /></section>;

  const onDay = (ymd: string) =>
    section.data!.filter((e) => (e.allDay ? e.start <= ymd && e.end > ymd : taipeiYmd(e.start) === ymd));
  const todays = onDay(date);
  const tomorrow = onDay(addDays(date, 1));
  const later = section.data.filter((e) => {
    const d = e.allDay ? e.start : taipeiYmd(e.start);
    return d > addDays(date, 1);
  });

  return (
    <section className="block">
      {head}
      {todays.length === 0 ? <p className="empty">今天沒有行程</p> : <EventList events={todays} now={now} />}
      {tomorrow.length > 0 && (
        <>
          <p className="sub">明天 · {dayLabel(addDays(date, 1))}</p>
          <EventList events={tomorrow} now={now} />
        </>
      )}
      {later.length > 0 && <p className="sub">之後 5 天還有 {later.length} 個行程</p>}
    </section>
  );
}

function EventList({ events, now }: { events: CalendarEvent[]; now: number }) {
  return (
    <ul className="events">
      {events.map((e, i) => {
        const past = !e.allDay && Date.parse(e.end) < now;
        const live = !e.allDay && Date.parse(e.start) <= now && Date.parse(e.end) > now;
        return (
          <li key={`${e.start}-${i}`} className={past ? 'is-past' : live ? 'is-live' : undefined}>
            <span className="ev-time num">{e.allDay ? '整天' : time(e.start)}</span>
            <span className="ev-body">
              <span className="ev-title">{e.title}</span>
              {(e.location || (!e.allDay && e.end !== e.start)) && (
                <span className="ev-meta">
                  {!e.allDay && e.end !== e.start && <>到 {time(e.end)}</>}
                  {e.location && <> · {e.location}</>}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
