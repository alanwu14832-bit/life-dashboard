import type { Health, Overview, Today } from '../../shared/types';
import { clock } from '../lib/format';

/** 一句話總結：平台狀況、今天到期幾件、下一個行程。 */
export function Summary({ data, today, counts, now }: { data: Overview | null; today: Today | null; counts: Record<Health, number>; now: number }) {
  if (!data) return null;
  const total = data.projects.length;
  const issues = counts.down + counts.warn;
  const dueToday = today?.tasks.data?.filter((t) => t.bucket !== 'soon').length ?? null;
  const overdue = today?.tasks.data?.filter((t) => t.bucket === 'overdue').length ?? 0;
  const next = today?.calendar.data?.find((e) => !e.allDay && Date.parse(e.end) > now);
  const nextToday = next && new Date(next.start).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }) === today?.date;

  return (
    <section className="summary-line" aria-label="總覽">
      <span className={`seg ${counts.down ? 't-down' : issues ? 't-warn' : 't-ok'}`}>
        <span className="seg-dot" aria-hidden="true" />
        {counts.down
          ? `${counts.down} 個平台異常`
          : counts.warn
            ? `${counts.warn} 個平台要注意`
            : `${total - counts.unknown} 個平台都正常`}
      </span>
      {dueToday !== null && (
        <span className={`seg ${overdue ? 't-warn' : ''}`}>
          {dueToday - overdue > 0 ? `今天 ${dueToday - overdue} 件到期` : '今天沒有到期的待辦'}
          {overdue > 0 && `，${overdue} 件逾期`}
        </span>
      )}
      {today?.calendar.data && (
        <span className="seg">
          {next && nextToday
            ? `下一個行程 ${clock(Date.parse(next.start))} ${next.title}`
            : '今天沒有其他行程'}
        </span>
      )}
    </section>
  );
}
