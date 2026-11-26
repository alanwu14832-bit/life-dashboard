import type { Today } from '../../../shared/types';
import { ErrorState, TodaySkeleton } from '../States';
import { CalendarBlock } from './CalendarBlock';
import { KnowledgeBlock } from './KnowledgeBlock';
import { SchedulesBlock } from './SchedulesBlock';
import { TasksBlock } from './TasksBlock';

interface Props {
  today: Today | null;
  error: string | null;
  now: number;
  onTaskDone: (id: string) => Promise<void>;
  onRetry: () => void;
}

/** 左欄「今天」：行程、待辦、排程、知識庫。每一塊各自顯示自己的錯誤。 */
export function TodayPanel({ today, error, now, onTaskDone, onRetry }: Props) {
  return (
    <aside className="today" aria-labelledby="today-title">
      <h2 id="today-title">今天</h2>
      {today ? (
        <>
          {error && <ErrorState message={`${error}（下面是上一次的資料）`} onRetry={onRetry} />}
          <CalendarBlock section={today.calendar} date={today.date} now={now} />
          <TasksBlock section={today.tasks} onTaskDone={onTaskDone} />
          <SchedulesBlock today={today} />
          <KnowledgeBlock today={today} now={now} />
        </>
      ) : error ? (
        <ErrorState message={error} onRetry={onRetry} />
      ) : (
        <TodaySkeleton />
      )}
    </aside>
  );
}
