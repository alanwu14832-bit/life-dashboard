// 每週回顧：這 7 天完成的待辦、各平台可用率／commit／異常次數、新筆記、下週預告。
// 週日晚上 9 點寄 email，網站上也有同一份（#week）。

import type { Section, Weekly } from '../shared/types';
import type { Mail } from './alerts';
import { fetchCommitsSince } from './checks';
import { eventsFromIcs } from './ics';
import { fetchDoneThisWeek, fetchKnowledge, fetchTasks } from './notion';
import { activeProjects, OWNER } from './projects';
import { addDays, ymdIn } from './time';

export interface WeeklyEnv {
  DB: D1Database;
  NOTION_TOKEN?: string;
  CALENDAR_ICS_URL?: string;
  GITHUB_TOKEN?: string;
}

const DAY = 86_400_000;

async function settle<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function buildWeekly(env: WeeklyEnv, now = Date.now()): Promise<Weekly> {
  const to = ymdIn(now);
  const from = addDays(to, -6);
  const since = now - 7 * DAY;
  const projects = await activeProjects(env.DB);
  const token = env.NOTION_TOKEN;
  const noNotion = { data: null, error: '還沒設定 NOTION_TOKEN' };

  const [uptimeRows, incidentRows, commits, done, notes, nextWeek] = await Promise.all([
    env.DB.prepare(`SELECT project, COUNT(*) AS n, SUM(ok) AS up FROM checks WHERE kind = 'http' AND ts >= ? GROUP BY project`)
      .bind(since)
      .all<{ project: string; n: number; up: number }>(),
    env.DB.prepare(`SELECT project, COUNT(*) AS n FROM incidents WHERE opened_at >= ? GROUP BY project`)
      .bind(since)
      .all<{ project: string; n: number }>()
      .catch(() => ({ results: [] as { project: string; n: number }[] })),
    fetchCommitsSince(OWNER, projects, new Date(since).toISOString(), env.GITHUB_TOKEN),
    token ? settle(() => fetchDoneThisWeek(token)) : Promise.resolve(noNotion),
    token ? settle(async () => (await fetchKnowledge(token)).map((k) => ({ title: k.title, url: k.url }))) : Promise.resolve(noNotion),
    settle(async () => {
      const tomorrow = addDays(to, 1);
      const tasks = token ? (await fetchTasks(token, tomorrow)).filter((t) => t.bucket !== 'overdue').length : 0;
      let events = 0;
      if (env.CALENDAR_ICS_URL) {
        const res = await fetch(env.CALENDAR_ICS_URL, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) events = eventsFromIcs(await res.text(), tomorrow, 7).length;
      }
      return { events, tasks };
    }),
  ]);

  const up = new Map(uptimeRows.results.map((r) => [r.project, r.n ? r.up / r.n : null]));
  const inc = new Map(incidentRows.results.map((r) => [r.project, r.n]));
  return {
    from,
    to,
    done,
    notes,
    nextWeek,
    platforms: projects.map((p) => ({ id: p.id, name: p.name, uptime: up.get(p.id) ?? null, commits: commits[p.id] ?? null, incidents: inc.get(p.id) ?? 0 })),
  };
}

const pct = (v: number | null) => (v === null ? '—' : v >= 1 ? '100%' : `${(Math.floor(v * 1000) / 10).toFixed(1)}%`);
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export function composeWeeklyMail(w: Weekly, siteUrl: string): Mail {
  const lines: string[] = [];
  const done = w.done.data;
  lines.push(`【這週完成】${done ? `${done.length} 件待辦` : `讀不到（${w.done.error}）`}`);
  done?.slice(0, 15).forEach((d) => lines.push(`・${d.title}`));
  if (done && done.length > 15) lines.push(`・還有 ${done.length - 15} 件`);
  lines.push('');
  lines.push('【平台】可用率 · commit · 異常');
  for (const p of w.platforms)
    lines.push(`・${p.name}：${pct(p.uptime)} · ${p.commits ?? '—'} 次 commit · ${p.incidents ? `異常 ${p.incidents} 次` : '沒有異常'}`);
  lines.push('');
  const notes = w.notes.data;
  lines.push(`【新筆記】${notes ? `${notes.length} 篇` : '讀不到'}`);
  notes?.forEach((n) => lines.push(`・${n.title}`));
  lines.push('');
  if (w.nextWeek.data) lines.push(`【下週】${w.nextWeek.data.events} 個行程、${w.nextWeek.data.tasks} 件待辦到期`);
  lines.push('');
  lines.push(`完整週報：${siteUrl}#week`);
  return { subject: `【週報】${md(w.from)}–${md(w.to)}：完成 ${done?.length ?? 0} 件待辦`, text: lines.join('\n') };
}
