// 日期工具。一律以台北時間決定「今天」。

export const TAIPEI = 'Asia/Taipei';
const DAY = 86_400_000;

/** 某個時刻在指定時區的日期，格式 YYYY-MM-DD。 */
export function ymdIn(ms: number, tz = TAIPEI): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(ms),
  );
}

/** 純日期加減天數（不牽涉時區）。 */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY).toISOString().slice(0, 10);
}

/** 星期幾，0 = 星期日。 */
export function weekday(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 某個時刻在台北的小時與分鐘。 */
export function taipeiMinutes(ms: number): number {
  // 台灣沒有日光節約時間，固定 UTC+8
  const d = new Date(ms + 8 * 3_600_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

const offsetCache = new Map<string, Intl.DateTimeFormat>();

/** 時區在某個時刻相對 UTC 的偏移（毫秒）。 */
function tzOffset(ms: number, tz: string): number {
  let fmt = offsetCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetCache.set(tz, fmt);
  }
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** 把某時區的牆上時間換成 UTC 毫秒。未知時區當作台北。 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  if (tz === TAIPEI) return naive - 8 * 3_600_000;
  try {
    const first = naive - tzOffset(naive, tz);
    return naive - tzOffset(first, tz);
  } catch {
    return naive - 8 * 3_600_000;
  }
}
