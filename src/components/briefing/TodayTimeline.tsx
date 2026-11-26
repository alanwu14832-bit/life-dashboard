import { useState } from 'react';
import type { CalendarEvent, TaskItem, Today } from '../../../shared/types';
import { TaskCheck } from './TaskCheck';
import { hm, onDay } from './time';

const OVERDUE_PREVIEW = 5;

type Line =
  | { kind: 'event'; key: number; ev: CalendarEvent }
  | { kind: 'task'; key: number; task: TaskItem };

/** 今天：行程與今天到期的待辦併成一條時間線；逾期的接在最後。 */
export function TodayTimeline({ today, now, onTaskDone }: { today: Today; now: number; onTaskDone: (id: string) => Promise<void> }) {
  const [showAll, setShowAll] = useState(false);
  const events = today.calendar.data ? onDay(today.calendar.data, today.date) : [];
  const tasks = today.tasks.data ?? [];
  const lines: Line[] = [
    ...events.map((ev): Line => ({ kind: 'event', key: ev.allDay ? -1 : Date.parse(ev.start), ev })),
    ...tasks
      .filter((t) => t.bucket === 'today')
      .map((task): Line => ({ kind: 'task', key: task.due && task.due.length > 10 ? Date.parse(task.due) : Number.MAX_SAFE_INTEGER, task })),
  ].sort((a, b) => a.key - b.key);
  const overdue = tasks.filter((t) => t.bucket === 'overdue');
  const nextEv = events.find((e) => !e.allDay && Date.parse(e.start) > now);

  return (
    <section className="sec" aria-labelledby="sec-today">
      <h2 id="sec-today" className="sec-title">今天</h2>
      {today.calendar.error && <p className="sec-problem">行事曆：{today.calendar.error}</p>}
      {today.tasks.error && <p className="sec-problem">待辦：{today.tasks.error}</p>}
      {lines.length === 0 && overdue.length === 0 && !today.calendar.error && !today.tasks.error && (
        <p className="sec-empty">今天沒有行程，也沒有到期的待辦。</p>
      )}
      <ul className="lines">
        {lines.map((l) =>
          l.kind === 'event' ? (
            <EventLine key={`e-${l.ev.start}-${l.ev.title}`} ev={l.ev} now={now} isNext={l.ev === nextEv} />
          ) : (
            <TaskLine key={l.task.id} task={l.task} label={l.task.due && l.task.due.length > 10 ? hm(l.task.due) : '今天'} onDone={onTaskDone} />
          ),
        )}
        {(showAll ? overdue : overdue.slice(0, OVERDUE_PREVIEW)).map((t) => (
          <TaskLine key={t.id} task={t} label="逾期" tone="down" onDone={onTaskDone} extra={t.due ? `原訂 ${shortDate(t.due)}` : undefined} />
        ))}
      </ul>
      {overdue.length > OVERDUE_PREVIEW && (
        <button type="button" className="text-btn" onClick={() => setShowAll((v) => !v)}>
          {showAll ? '只看最近 5 件逾期' : `再顯示 ${overdue.length - OVERDUE_PREVIEW} 件更早的逾期`}
        </button>
      )}
    </section>
  );
}

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function EventLine({ ev, now, isNext }: { ev: CalendarEvent; now: number; isNext: boolean }) {
  const past = !ev.allDay && Date.parse(ev.end) <= now;
  const live = !ev.allDay && Date.parse(ev.start) <= now && Date.parse(ev.end) > now;
  return (
    <li className={`line${past ? ' is-past' : ''}${isNext || live ? ' is-next' : ''}`}>
      <span className="line-time">{ev.allDay ? '整天' : hm(ev.start)}</span>
      <div className="line-body">
        <div className="line-text">
          <span className="line-title">
            {ev.title}
            {live && <span className="line-flag">進行中</span>}
            {isNext && !live && <span className="line-flag">下一個</span>}
          </span>
          {(!ev.allDay || ev.location) && (
            <span className="line-meta">{[!ev.allDay ? `到 ${hm(ev.end)}` : null, ev.location].filter(Boolean).join(' · ')}</span>
          )}
        </div>
      </div>
    </li>
  );
}

export function TaskLine({ task, label, tone, extra, onDone }: { task: TaskItem; label: React.ReactNode; tone?: 'down'; extra?: string; onDone: (id: string) => Promise<void> }) {
  const meta = [extra, task.courses[0] ?? task.platform, task.type?.split(' ')[0], task.priority?.startsWith('高') ? '高優先' : null].filter(Boolean).join(' · ');
  return (
    <li className={`line${tone ? ` t-${tone}` : ''}`}>
      <span className="line-time">{label}</span>
      <div className="line-body">
        <TaskCheck task={task} onDone={onDone} />
        <div className="line-text">
          <a className="line-title" href={task.url} target="_blank" rel="noreferrer">
            <span className="kind">待辦</span>
            {task.title}
          </a>
          {meta && <span className="line-meta">{meta}</span>}
        </div>
      </div>
    </li>
  );
}

