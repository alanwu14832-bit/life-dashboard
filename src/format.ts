const TZ = 'Asia/Taipei';

/** 「剛剛」「5 分鐘前」「3 小時前」「2 天前」，超過兩週顯示日期。 */
export function ago(input: number | string | null | undefined, now = Date.now()): string {
  if (input === null || input === undefined) return '—';
  const t = typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return '剛剛';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.round(h / 24);
  if (d <= 14) return `${d} 天前`;
  return shortDate(t);
}

export function shortDate(t: number | string): string {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, month: 'numeric', day: 'numeric' }).format(new Date(t));
}

export function clock(t: number): string {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));
}

export function today(now = Date.now()): string {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(now));
}

export function pct(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1) return '100%';
  return `${(Math.floor(v * 1000) / 10).toFixed(1)}%`;
}

export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`;
}

export function hostLabel(host: string): string {
  return { vercel: 'Vercel', cloudflare: 'Cloudflare', 'github-pages': 'GitHub Pages' }[host] ?? host;
}
