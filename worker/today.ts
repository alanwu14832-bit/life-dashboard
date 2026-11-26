// 「今天」區塊：行程、待辦、排程健康、知識庫。每一塊各自成敗，一塊壞掉不影響其他塊。

import type { CalendarEvent, Section, Today } from '../shared/types';
import { eventsFromIcs } from './ics';
import { fetchKnowledge, fetchPlatformCounts, fetchSchedules, fetchTasks } from './notion';
import { ymdIn } from './time';
import { fetchWeather } from './weather';

export interface TodayEnv {
  NOTION_TOKEN?: string;
  CALENDAR_ICS_URL?: string;
}

type Fetch = typeof fetch;

const CAL_DAYS = 7;
const ICS_TTL_MS = 5 * 60_000;
// 行事曆原始檔與解析結果都快取 5 分鐘：解析是整個 Worker 最吃 CPU 的一步
let icsCache: { url: string; date: string; at: number; events: CalendarEvent[] } | null = null;

async function settle<T>(fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const missing = <T>(error: string): Promise<Section<T>> => Promise.resolve({ data: null, error });

async function calendarEvents(url: string, date: string, f: Fetch): Promise<CalendarEvent[]> {
  if (icsCache && icsCache.url === url && icsCache.date === date && Date.now() - icsCache.at < ICS_TTL_MS)
    return icsCache.events;
  const res = await f(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'text/calendar' } });
  if (res.status === 404) throw new Error('行事曆網址失效，請重新複製「iCal 格式的私人網址」');
  if (!res.ok) throw new Error(`讀不到行事曆（HTTP ${res.status}）`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('這個網址不是 iCal 格式的行事曆');
  const events = eventsFromIcs(text, date, CAL_DAYS);
  icsCache = { url, date, at: Date.now(), events };
  return events;
}

export async function buildToday(env: TodayEnv, now = Date.now(), f: Fetch = fetch): Promise<Today> {
  const date = ymdIn(now);
  const token = env.NOTION_TOKEN;
  const noNotion = '還沒設定 NOTION_TOKEN';

  const [tasks, platformTasks, schedules, knowledge, calendar, weather] = await Promise.all([
    token ? settle(() => fetchTasks(token, date, f)) : missing<never>(noNotion),
    token ? settle(() => fetchPlatformCounts(token, f)) : missing<never>(noNotion),
    token ? settle(() => fetchSchedules(token, date, now, f)) : missing<never>(noNotion),
    token ? settle(() => fetchKnowledge(token, f)) : missing<never>(noNotion),
    env.CALENDAR_ICS_URL
      ? settle(() => calendarEvents(env.CALENDAR_ICS_URL!, date, f))
      : missing<never>('還沒設定 CALENDAR_ICS_URL'),
    settle(() => fetchWeather(f, now)),
  ]);

  return { date, tasks, platformTasks, calendar, schedules, knowledge, weather };
}

// 整個今天區塊在同一個 Worker 執行個體裡快取 60 秒；勾選完成後清掉
const TODAY_TTL_MS = 60_000;
let todayCache: { at: number; date: string; data: Today } | null = null;

export async function cachedToday(env: TodayEnv, fresh = false, now = Date.now()): Promise<Today> {
  const date = ymdIn(now);
  if (!fresh && todayCache && todayCache.date === date && now - todayCache.at < TODAY_TTL_MS) return todayCache.data;
  const data = await buildToday(env, now);
  todayCache = { at: now, date, data };
  return data;
}

export function invalidateToday(): void {
  todayCache = null;
}
