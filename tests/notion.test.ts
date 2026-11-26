import { describe, expect, it } from 'vitest';
import { completeTask, fetchKnowledge, fetchPlatformCounts, fetchSchedules, fetchTasks, SOURCES } from '../worker/notion';
import { buildToday } from '../worker/today';

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/** 依網址回應的假 fetch，並記下每一次呼叫。 */
function fakeNotion(routes: Record<string, unknown | ((call: Call) => unknown)>, status = 200) {
  const calls: Call[] = [];
  const f = (async (input: string, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)),
    };
    calls.push(call);
    const key = Object.keys(routes).find((k) => call.url.includes(k));
    if (!key) return new Response(JSON.stringify({ code: 'object_not_found', message: 'not found' }), { status: 404 });
    const v = routes[key];
    return new Response(JSON.stringify(typeof v === 'function' ? (v as (c: Call) => unknown)(call) : v), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const title = (t: string) => ({ type: 'title', title: [{ plain_text: t }] });
const sel = (name: string | null) => ({ type: 'select', select: name ? { name } : null });
const dateP = (start: string | null) => ({ type: 'date', date: start ? { start } : null });

const task = (id: string, name: string, due: string, extra: Record<string, unknown> = {}) => ({
  id,
  url: `https://www.notion.so/${id}`,
  created_time: '2026-11-20T00:00:00.000Z',
  properties: {
    '待辦 Task': title(name),
    '截止日 Due': dateP(due),
    '狀態 Status': sel('未開始 Not Started'),
    '優先級 Priority': sel('高 High'),
    '類型 Type': sel('作業 Assignment'),
    '平台 Platform': sel(null),
    '課程 Course': { type: 'relation', relation: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }] },
    ...extra,
  },
});

describe('待辦', () => {
  it('分兩次查：逾期的從最近開始取，今天起 7 天內的照截止日排', async () => {
    const { f, calls } = fakeNotion({
      [`data_sources/${SOURCES.tasks}/query`]: { results: [] },
      [`data_sources/${SOURCES.courses}/query`]: { results: [] },
    });
    await fetchTasks('secret', '2026-11-26', f);
    const qs = calls.filter((c) => c.url.includes(SOURCES.tasks));
    expect(qs).toHaveLength(2);
    expect(qs[0].method).toBe('POST');
    expect(qs[0].headers['notion-version']).toBe('2025-09-03');
    expect(qs[0].headers.authorization).toBe('Bearer secret');
    expect(qs[0].body).toMatchObject({
      filter: { and: [{ property: '狀態 Status', select: { does_not_equal: '完成 Done' } }, { property: '截止日 Due', date: { before: '2026-11-26' } }] },
      sorts: [{ property: '截止日 Due', direction: 'descending' }],
    });
    expect(qs[1].body).toMatchObject({
      filter: {
        and: [
          { property: '狀態 Status', select: { does_not_equal: '完成 Done' } },
          { property: '截止日 Due', date: { on_or_after: '2026-11-26' } },
          { property: '截止日 Due', date: { on_or_before: '2026-12-03' } },
        ],
      },
      sorts: [{ property: '截止日 Due', direction: 'ascending' }],
    });
  });

  it('分成逾期、今天、之後，並帶出課程名稱', async () => {
    const { f } = fakeNotion({
      [`data_sources/${SOURCES.tasks}/query`]: {
        results: [
          task('11111111-1111-1111-1111-111111111111', '財管作業', '2026-11-24'),
          task('22222222-2222-2222-2222-222222222222', '會計小考', '2026-11-26T09:00:00.000+08:00'),
          task('33333333-3333-3333-3333-333333333333', '期末報告', '2026-11-30'),
        ],
      },
      [`data_sources/${SOURCES.courses}/query`]: {
        results: [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', url: '', created_time: '', properties: { 名稱: title('中級會計學') } }],
      },
    });
    const list = await fetchTasks('t', '2026-11-26', f);
    expect(list.map((t) => [t.title, t.bucket])).toEqual([
      ['財管作業', 'overdue'],
      ['會計小考', 'today'],
      ['期末報告', 'soon'],
    ]);
    expect(list[0]).toMatchObject({ priority: '高 High', type: '作業 Assignment', courses: ['中級會計學'], url: 'https://www.notion.so/11111111-1111-1111-1111-111111111111' });
  });

  it('依平台計算未完成件數', async () => {
    const { f } = fakeNotion({
      [`data_sources/${SOURCES.tasks}/query`]: {
        results: [
          task('1', 'a', '2026-11-26', { '平台 Platform': sel('NTU BaFiN Stats') }),
          task('2', 'b', '2026-11-27', { '平台 Platform': sel('NTU BaFiN Stats') }),
          task('3', 'c', '2026-11-28', { '平台 Platform': sel('CaseNote') }),
        ],
      },
    });
    expect(await fetchPlatformCounts('t', f)).toEqual({ 'NTU BaFiN Stats': 2, CaseNote: 1 });
  });

  it('標成完成：只改狀態欄位', async () => {
    const { f, calls } = fakeNotion({ '/pages/': {} });
    await completeTask('t', '11111111-1111-1111-1111-111111111111', f);
    expect(calls[0]).toMatchObject({
      url: 'https://api.notion.com/v1/pages/11111111-1111-1111-1111-111111111111',
      method: 'PATCH',
      body: { properties: { '狀態 Status': { select: { name: '完成 Done' } } } },
    });
  });

  it('不合格式的 ID 直接拒絕，不送出請求', async () => {
    const { f, calls } = fakeNotion({});
    await expect(completeTask('t', '../databases/x', f)).rejects.toThrow('格式不對');
    expect(calls).toHaveLength(0);
  });

  it('integration 沒拿到資料庫權限時，錯誤訊息說明怎麼加', async () => {
    const { f } = fakeNotion({});
    await expect(fetchTasks('t', '2026-11-26', f)).rejects.toThrow('Connections');
  });
});

describe('排程健康', () => {
  const latest = (d: string) => ({
    results: [{ id: 'x', url: 'https://www.notion.so/x', created_time: '', properties: { '標題 Title': title(`簡報 ${d}`), '日期 Date': dateP(d) } }],
  });
  const routes = (b: string, tw: string) => ({
    [`data_sources/${SOURCES.briefing}/query`]: latest(b),
    [`data_sources/${SOURCES.twClose}/query`]: latest(tw),
  });
  // 2026-11-26 星期四；10:00 = 02:00Z，19:00 = 11:00Z
  const at = (hhmm: string) => Date.parse(`2026-11-26T${hhmm}:00+08:00`);

  it('今天已寫入', async () => {
    const { f } = fakeNotion(routes('2026-11-26', '2026-11-26'));
    const [b, tw] = await fetchSchedules('t', '2026-11-26', at('19:00'), f);
    expect(b).toMatchObject({ name: '晨間簡報', state: 'ok', latestDate: '2026-11-26' });
    expect(tw.state).toBe('ok');
  });

  it('平日早上還沒寫是正常的', async () => {
    const { f } = fakeNotion(routes('2026-11-25', '2026-11-25'));
    const [b] = await fetchSchedules('t', '2026-11-26', at('10:00'), f);
    expect(b.state).toBe('idle');
  });

  it('平日傍晚還沒寫就提醒', async () => {
    const { f } = fakeNotion(routes('2026-11-25', '2026-11-26'));
    const [b, tw] = await fetchSchedules('t', '2026-11-26', at('19:00'), f);
    expect(b.state).toBe('late');
    expect(tw.state).toBe('ok');
  });

  it('週末不算遲到', async () => {
    const { f } = fakeNotion(routes('2026-11-27', '2026-11-27'));
    const [b] = await fetchSchedules('t', '2026-11-28', Date.parse('2026-11-28T20:00:00+08:00'), f);
    expect(b).toMatchObject({ state: 'idle', note: '週末不產出' });
  });
});

describe('知識庫', () => {
  it('最近 7 天、新的在前', async () => {
    const { f, calls } = fakeNotion({
      [`data_sources/${SOURCES.knowledge}/query`]: {
        results: [{ id: 'k', url: 'https://www.notion.so/k', created_time: '2026-11-26T05:00:00.000Z', properties: { 標題: title('個人儀表板決策'), 主題: sel('技術與工具'), 類型: sel('決策記錄') } }],
      },
    });
    expect(await fetchKnowledge('t', f)).toEqual([
      { title: '個人儀表板決策', topic: '技術與工具', type: '決策記錄', created: '2026-11-26T05:00:00.000Z', url: 'https://www.notion.so/k' },
    ]);
    expect(calls[0].body).toMatchObject({ filter: { timestamp: 'created_time', created_time: { past_week: {} } } });
  });
});

describe('今天區塊', () => {
  it('沒設定金鑰時每一塊各自說明缺什麼，不會整個壞掉', async () => {
    const today = await buildToday({}, Date.parse('2026-11-26T10:00:00+08:00'));
    expect(today.date).toBe('2026-11-26');
    expect(today.tasks).toEqual({ data: null, error: '還沒設定 NOTION_TOKEN' });
    expect(today.calendar).toEqual({ data: null, error: '還沒設定 CALENDAR_ICS_URL' });
  });

  it('一塊失敗不影響其他塊', async () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=Asia/Taipei:20261126T140000\r\nDTEND;TZID=Asia/Taipei:20261126T150000\r\nSUMMARY:社課\r\nEND:VEVENT\r\nEND:VCALENDAR';
    const f = (async (input: string) => {
      if (String(input).startsWith('https://calendar.test/')) return new Response(ics);
      return new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 });
    }) as unknown as typeof fetch;
    const today = await buildToday(
      { NOTION_TOKEN: 'bad', CALENDAR_ICS_URL: 'https://calendar.test/basic.ics' },
      Date.parse('2026-11-26T10:00:00+08:00'),
      f,
    );
    expect(today.tasks.error).toContain('權杖無效');
    expect(today.calendar.data?.map((e) => e.title)).toEqual(['社課']);
  });
});
