import type { Overview, Today } from '../../../shared/types';

const TZ = 'Asia/Taipei';
const hm = (iso: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const ymdOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });

export interface LedePart {
  text: string;
  tone?: 'warn' | 'down';
}

/** 一段完整句子的總結：平台、待辦、下一個行程。用片段組成，讓有狀況的部分可以上色。 */
export function buildLede(overview: Overview | null, today: Today | null, now: number): LedePart[] {
  const parts: LedePart[] = [];
  if (overview) {
    const list = overview.projects;
    const watched = list.filter((p) => p.health !== 'unknown');
    const ok = watched.filter((p) => p.health === 'ok').length;
    const bad = list.filter((p) => p.health === 'down' || p.health === 'warn');
    if (!bad.length) parts.push({ text: `${watched.length} 個平台都正常。` });
    else {
      parts.push({ text: `${watched.length} 個平台裡 ${ok} 個正常，` });
      bad.slice(0, 2).forEach((p, i) => {
        parts.push({ text: `${p.config.name}${p.reasons[0] ? ` ${p.reasons[0].replace(/（.*）$/, '')}` : ''}`, tone: p.health === 'down' ? 'down' : 'warn' });
        if (i < Math.min(bad.length, 2) - 1) parts.push({ text: '、' });
      });
      parts.push({ text: bad.length > 2 ? ` 等 ${bad.length} 個要注意。` : '。' });
    }
  }
  const tasks = today?.tasks.data;
  if (tasks) {
    const due = tasks.filter((t) => t.bucket === 'today').length;
    const over = tasks.filter((t) => t.bucket === 'overdue').length;
    if (due || over) {
      parts.push({ text: due ? `今天有 ${due} 件待辦到期` : '今天沒有到期的待辦' });
      if (over) parts.push({ text: `、${over} 件逾期`, tone: 'warn' });
    } else parts.push({ text: '今天沒有到期的待辦' });
  }
  const events = today?.calendar.data;
  if (events && today) {
    const next = events.find((e) => !e.allDay && Date.parse(e.start) > now && ymdOf(e.start) === today.date);
    parts.push({ text: next ? `；下一個行程是 ${hm(next.start)} 的${next.title}。` : '；今天沒有其他行程了。' });
  } else if (tasks) parts.push({ text: '。' });
  return parts;
}
