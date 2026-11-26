

export const TZ = 'Asia/Taipei';
export const NOTION_TASKS = 'https://app.notion.com/p/864e77f5270f43108fc6ab6cbc287f37';
export const CALENDAR_DAY = 'https://calendar.google.com/calendar/r/day';

export const time = (iso: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const dayLabel = (ymd: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC', month: 'numeric', day: 'numeric', weekday: 'short' }).format(new Date(`${ymd}T00:00:00Z`));
export const taipeiYmd = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function addDays(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
