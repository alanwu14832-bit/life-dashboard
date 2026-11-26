import { useState } from 'react';
import type { CalendarEvent, Section, TaskItem, Today } from '../shared/types';
import { ago } from './format';

const TZ = 'Asia/Taipei';
const NOTION_TASKS = 'https://app.notion.com/p/864e77f5270f43108fc6ab6cbc287f37';
const CALENDAR_DAY = 'https://calendar.google.com/calendar/r/day';

const time = (iso: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const dayLabel = (ymd: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${ymd}T00:00:00Z`));
const taipeiYmd = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function TodayPanel({ today, now, onTaskDone }: { today: Today | null; now: number; onTaskDone: (id: string) => Promise<void> }) {
  if (!today) {
    return (
      <aside className="today" aria-label="今天">
        <h2>今天</h2>
        <p className="today-note">讀取中…</p>
      </aside>
    );
  }
  return (
    <aside className="today" aria-label="今天">
      <h2>今天</h2>
      <CalendarBlock section={today.calendar} date={today.date} now={now} />
      <TasksBlock section={today.tasks} onTaskDone={onTaskDone} />
      <SchedulesBlock today={today} />
      <KnowledgeBlock today={today} now={now} />
    </aside>
  );
}

function Problem({ error, hint }: { error: string; hint?: string }) {
  return (
    <p className="block-problem">
      {error}
      {hint && <span>{hint}</span>}
    </p>
  );
}

function CalendarBlock({ section, date, now }: { section: Section<CalendarEvent[]>; date: string; now: number }) {
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

const BUCKET_LABEL: Record<TaskItem['bucket'], string> = { overdue: '逾期', today: '今天到期', soon: '7 天內' };

function TasksBlock({ section, onTaskDone }: { section: Section<TaskItem[]>; onTaskDone: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState<Record<string, 'saving' | 'error'>>({});
  const head = (
    <div className="block-head">
      <h3>待辦</h3>
      <a href={NOTION_TASKS} target="_blank" rel="noreferrer">
        Notion
      </a>
    </div>
  );
  if (!section.data)
    return (
      <section className="block">
        {head}
        <Problem error={section.error ?? '讀不到待辦'} />
      </section>
    );

  const done = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: 'saving' }));
    try {
      await onTaskDone(id);
    } catch {
      setBusy((b) => ({ ...b, [id]: 'error' }));
    }
  };

  const groups = (['overdue', 'today', 'soon'] as const)
    .map((b) => ({ bucket: b, items: section.data!.filter((t) => t.bucket === b) }))
    .filter((g) => g.items.length);

  return (
    <section className="block">
      {head}
      {groups.length === 0 && <p className="empty">7 天內沒有到期的待辦</p>}
      {groups.map((g) => (
        <div key={g.bucket} className={`task-group g-${g.bucket}`}>
          <p className="sub">
            {BUCKET_LABEL[g.bucket]} · {g.items.length}
          </p>
          <ul className="tasks">
            {g.items.map((t) => (
              <li key={t.id} className={busy[t.id] === 'saving' ? 'is-saving' : undefined}>
                <input
                  type="checkbox"
                  id={`task-${t.id}`}
                  aria-label={`把「${t.title}」標成完成`}
                  disabled={busy[t.id] === 'saving'}
                  checked={busy[t.id] === 'saving'}
                  onChange={() => done(t.id)}
                />
                <span className="task-body">
                  <a href={t.url} target="_blank" rel="noreferrer" className="task-title">
                    {t.title}
                  </a>
                  <span className="task-meta">
                    {[
                      g.bucket === 'soon' && t.due ? dayLabel(t.due.slice(0, 10)) : null,
                      t.due && t.due.length > 10 ? time(t.due) : null,
                      t.courses[0] ?? t.platform,
                      t.type?.split(' ')[0],
                      t.priority?.startsWith('高') ? '高優先' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {busy[t.id] === 'error' && <span className="task-error">沒有存到 Notion，再勾一次試試</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SchedulesBlock({ today }: { today: Today }) {
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

function KnowledgeBlock({ today, now }: { today: Today; now: number }) {
  const { knowledge } = today;
  return (
    <section className="block">
      <div className="block-head">
        <h3>知識庫 · 最近 7 天</h3>
      </div>
      {!knowledge.data ? (
        <Problem error={knowledge.error ?? '讀不到知識庫'} />
      ) : knowledge.data.length === 0 ? (
        <p className="empty">這 7 天沒有新筆記</p>
      ) : (
        <ul className="notes">
          {knowledge.data.map((k) => (
            <li key={k.url}>
              <a href={k.url} target="_blank" rel="noreferrer">
                {k.title}
              </a>
              <span className="note-meta">
                {[k.topic, ago(k.created, now)].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
