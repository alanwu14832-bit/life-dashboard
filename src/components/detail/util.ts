

export const TZ = 'Asia/Taipei';
export const dt = (t: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, ...opts }).format(new Date(t));
export const when = (t: number) => dt(t, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function span(msLen: number): string {
  const m = Math.max(1, Math.round(msLen / 60_000));
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小時 ${m % 60} 分` : `${h} 小時`;
}
