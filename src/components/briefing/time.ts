import type { CalendarEvent } from '../../../shared/types';

export const TZ = 'Asia/Taipei';
export const hm = (iso: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const ymdOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const dayLabel = (ymd: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${ymd}T00:00:00Z`));

/** 某一天（台北日期）的行程；跨日的整天行程每天都算 */
export function onDay(events: CalendarEvent[], ymd: string): CalendarEvent[] {
  return events.filter((e) => (e.allDay ? e.start <= ymd && e.end > ymd : ymdOf(e.start) === ymd));
}

/** 時間欄用的日期：「11/27」與「週五」分兩行 */
export function dayParts(ymd: string): { md: string; wd: string } {
  const d = new Date(`${ymd}T00:00:00Z`);
  return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', weekday: 'short' }).format(d) };
}
