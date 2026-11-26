// Notion：讀待辦、晨間簡報、台股收盤、知識庫；把待辦標成完成。
// Notion 仍是唯一輸入處，這裡只讀、只改「狀態」一個欄位。

import type { KnowledgeItem, ScheduleStatus, TaskItem } from '../shared/types';
import { addDays, taipeiMinutes, weekday } from './time';

type Fetch = typeof fetch;

const API = 'https://api.notion.com/v1';
const VERSION = '2025-09-03';

export const SOURCES = {
  tasks: 'c746724b-8f58-4d80-aa1d-949a6c585c4c',
  courses: '8d27dfcc-c125-4617-a2f1-6edaec41b428',
  briefing: '60e90d79-f43c-44ce-ac37-3631574d00f5',
  twClose: 'acb59472-e926-453c-a1f1-58be01d012a8',
  knowledge: '2e2509f9-a77b-4a13-b4e8-6a9e6b1ff7b6',
} as const;

const P = {
  title: '待辦 Task',
  due: '截止日 Due',
  status: '狀態 Status',
  priority: '優先級 Priority',
  type: '類型 Type',
  course: '課程 Course',
  platform: '平台 Platform',
  done: '完成 Done',
} as const;

export class NotionError extends Error {}

function explain(status: number, code: string | undefined, message: string | undefined, what: string): string {
  if (status === 401) return 'Notion 權杖無效，請重新複製 integration 的金鑰';
  if (status === 404 || code === 'object_not_found')
    return `Notion integration 還沒拿到「${what}」的權限：到那個資料庫右上角 ⋯ → Connections 加入`;
  if (status === 429) return 'Notion 暫時限制請求次數，稍後會自動恢復';
  return `Notion 回應 HTTP ${status}${message ? `：${message}` : ''}`;
}

async function call<T>(token: string, path: string, init: RequestInit, what: string, f: Fetch): Promise<T> {
  const res = await f(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'notion-version': VERSION,
      'content-type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) throw new NotionError(explain(res.status, body.code, body.message, what));
  return body as T;
}

interface Page {
  id: string;
  url: string;
  created_time: string;
  properties: Record<string, NotionProp>;
}
// Notion 屬性值的形狀依 type 而不同，這裡只讀用得到的幾種
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotionProp = { type: string; [k: string]: any };

function query(token: string, source: string, body: object, what: string, f: Fetch) {
  return call<{ results: Page[] }>(token, `/data_sources/${source}/query`, { method: 'POST', body: JSON.stringify(body) }, what, f);
}

function text(p: NotionProp | undefined): string {
  const arr = p?.type === 'title' ? p.title : p?.type === 'rich_text' ? p.rich_text : null;
  return Array.isArray(arr) ? arr.map((t: { plain_text: string }) => t.plain_text).join('') : '';
}
const select = (p: NotionProp | undefined): string | null => (p?.type === 'select' ? (p.select?.name ?? null) : null);
const date = (p: NotionProp | undefined): string | null => (p?.type === 'date' ? (p.date?.start ?? null) : null);
const relation = (p: NotionProp | undefined): string[] =>
  p?.type === 'relation' && Array.isArray(p.relation) ? p.relation.map((r: { id: string }) => r.id) : [];
const titleOf = (page: Page) => text(Object.values(page.properties).find((p) => p.type === 'title'));

// 課程名稱一小時讀一次就好
let courseCache: { at: number; map: Map<string, string> } | null = null;

async function courseNames(token: string, f: Fetch): Promise<Map<string, string>> {
  if (courseCache && Date.now() - courseCache.at < 3_600_000) return courseCache.map;
  try {
    const { results } = await query(token, SOURCES.courses, { page_size: 100 }, '課程資料庫', f);
    const map = new Map(results.map((p) => [p.id.replace(/-/g, ''), titleOf(p)]));
    if (map.size) courseCache = { at: Date.now(), map };
    return map;
  } catch {
    // 沒分享課程資料庫也沒關係，只是不顯示課名
    return new Map();
  }
}

/**
 * 逾期、今天到期、7 天內到期，而且還沒完成的待辦。
 * 分兩次查：逾期的從最近的開始取，今天起 7 天內的照截止日排，
 * 這樣累積了很多沒打勾的舊待辦時，也不會把今天和這週的擠掉。
 */
export async function fetchTasks(token: string, today: string, f: Fetch = fetch): Promise<TaskItem[]> {
  const notDone = { property: P.status, select: { does_not_equal: P.done } };
  const [overdue, upcoming, courses] = await Promise.all([
    query(
      token,
      SOURCES.tasks,
      {
        filter: { and: [notDone, { property: P.due, date: { before: today } }] },
        sorts: [{ property: P.due, direction: 'descending' }],
        page_size: 50,
      },
      '✅ Tasks 待辦事項',
      f,
    ),
    query(
      token,
      SOURCES.tasks,
      {
        filter: {
          and: [
            notDone,
            { property: P.due, date: { on_or_after: today } },
            { property: P.due, date: { on_or_before: addDays(today, 7) } },
          ],
        },
        sorts: [{ property: P.due, direction: 'ascending' }],
        page_size: 50,
      },
      '✅ Tasks 待辦事項',
      f,
    ),
    courseNames(token, f),
  ]);

  const seen = new Set<string>();
  return [...overdue.results, ...upcoming.results].flatMap((page) => {
    if (seen.has(page.id)) return [];
    seen.add(page.id);
    const pr = page.properties;
    const due = date(pr[P.due]);
    const dueDay = due?.slice(0, 10) ?? today;
    const item: TaskItem = {
      id: page.id,
      title: text(pr[P.title]) || '（無標題）',
      url: page.url,
      due,
      status: select(pr[P.status]),
      priority: select(pr[P.priority]),
      type: select(pr[P.type]),
      platform: select(pr[P.platform]),
      courses: relation(pr[P.course])
        .map((id) => courses.get(id.replace(/-/g, '')))
        .filter((n): n is string => !!n),
      bucket: dueDay < today ? 'overdue' : dueDay === today ? 'today' : 'soon',
    };
    return [item];
  });
}

/** 每個平台還有幾件沒完成的待辦（看「平台 Platform」欄）。 */
export async function fetchPlatformCounts(token: string, f: Fetch = fetch): Promise<Record<string, number>> {
  const { results } = await query(
    token,
    SOURCES.tasks,
    {
      filter: {
        and: [
          { property: P.status, select: { does_not_equal: P.done } },
          { property: P.platform, select: { is_not_empty: true } },
        ],
      },
      page_size: 100,
    },
    '✅ Tasks 待辦事項',
    f,
  );
  const counts: Record<string, number> = {};
  for (const page of results) {
    const name = select(page.properties[P.platform]);
    if (name) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

export async function completeTask(token: string, id: string, f: Fetch = fetch): Promise<void> {
  if (!UUID.test(id)) throw new NotionError('待辦 ID 格式不對');
  await call(
    token,
    `/pages/${id}`,
    { method: 'PATCH', body: JSON.stringify({ properties: { [P.status]: { select: { name: P.done } } } }) },
    '✅ Tasks 待辦事項',
    f,
  );
}

interface ScheduleSpec {
  name: string;
  source: string;
  /** 平日幾點（台北，分鐘）之後應該要有今天的一筆 */
  dueAfter: number;
  idleNote: string;
}

const SCHEDULES: ScheduleSpec[] = [
  // 晨間簡報實際由 Mac 醒機後才觸發，中午到傍晚都可能，所以傍晚 6 點才算遲到
  { name: '晨間簡報', source: SOURCES.briefing, dueAfter: 18 * 60, idleNote: '平日由排程產出，Mac 醒來後才會跑' },
  { name: '台股收盤', source: SOURCES.twClose, dueAfter: 18 * 60, idleNote: '平日收盤後寫入' },
];

/** 排程健康：今天該有的那一筆寫進去了沒。 */
export async function fetchSchedules(token: string, today: string, now: number, f: Fetch = fetch): Promise<ScheduleStatus[]> {
  return Promise.all(
    SCHEDULES.map(async (s) => {
      const { results } = await query(
        token,
        s.source,
        { sorts: [{ property: '日期 Date', direction: 'descending' }], page_size: 1 },
        s.name,
        f,
      );
      const page = results[0];
      const latestDate = page ? (date(page.properties['日期 Date'])?.slice(0, 10) ?? null) : null;
      const base = { name: s.name, latestDate, latestTitle: page ? titleOf(page) : null, url: page?.url ?? null };
      const dow = weekday(today);
      if (latestDate === today) return { ...base, state: 'ok' as const, note: '今天已寫入' };
      if (dow === 0 || dow === 6) return { ...base, state: 'idle' as const, note: '週末不產出' };
      if (taipeiMinutes(now) < s.dueAfter) return { ...base, state: 'idle' as const, note: `今天還沒有，${s.idleNote}` };
      return { ...base, state: 'late' as const, note: '今天還沒有，排程可能斷了；國定假日本來就沒有' };
    }),
  );
}

/** 知識庫最近 7 天的筆記。 */
export async function fetchKnowledge(token: string, f: Fetch = fetch): Promise<KnowledgeItem[]> {
  const { results } = await query(
    token,
    SOURCES.knowledge,
    {
      filter: { timestamp: 'created_time', created_time: { past_week: {} } },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: 8,
    },
    '🧠 Claude 知識庫',
    f,
  );
  return results.map((p) => ({
    title: titleOf(p) || '（無標題）',
    topic: select(p.properties['主題']),
    type: select(p.properties['類型']),
    created: p.created_time,
    url: p.url,
  }));
}
