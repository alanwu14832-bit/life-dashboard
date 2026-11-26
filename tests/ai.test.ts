import { describe, expect, it } from 'vitest';
import { AiError, AiLimitError, buildAiInput, ensureBrief, generateBrief, MAX_REGEN_PER_DAY } from '../worker/ai';
import type { Overview, Today } from '../shared/types';

// 2026-11-26（週四）08:00 台北
const NOW = Date.UTC(2026, 10, 26, 0, 0);

const today: Today = {
  date: '2026-11-26',
  weather: { data: { place: '台北', now: 20, high: 23, low: 18, rain: 60, label: '陣雨' }, error: null },
  schedules: {
    data: [
      { name: '晨間簡報', state: 'ok', note: '', latestDate: '2026-11-26', latestTitle: 'x', url: 'https://notion.so/secret-page', headline: '聯準會會議紀要偏鴿', figure: null, direction: null },
    ],
    error: null,
  },
  calendar: {
    data: [
      { title: '統計學', location: '社科 101', allDay: false, start: '2026-11-26T02:10:00.000Z', end: '2026-11-26T05:00:00.000Z' },
      { title: '期中考週', location: null, allDay: true, start: '2026-11-26', end: '2026-11-27' },
      { title: '校隊練習', location: null, allDay: false, start: '2026-11-27T00:00:00.000Z', end: '2026-11-27T02:00:00.000Z' },
    ],
    error: null,
  },
  tasks: {
    data: [
      { id: '1', title: '統計作業三', url: 'https://www.notion.so/abc', due: '2026-11-26T15:59:00.000+08:00', status: null, priority: '高 High', type: '作業 Homework', platform: null, courses: ['統計學'], bucket: 'today' },
      { id: '2', title: '整理筆記', url: 'https://www.notion.so/def', due: '2026-11-20', status: null, priority: null, type: null, platform: null, courses: [], bucket: 'overdue' },
      { id: '3', title: '經濟學報告', url: 'https://www.notion.so/ghi', due: '2026-11-30', status: null, priority: null, type: '報告 Report', platform: null, courses: ['經濟學'], bucket: 'soon' },
    ],
    error: null,
  },
  platformTasks: { data: {}, error: null },
  knowledge: { data: [], error: null },
};

const overview = {
  projects: [
    { config: { id: 'a', name: 'LiveLyrics', url: 'https://livelyrics-omega.vercel.app' }, health: 'down', reasons: ['網站打不開'], mutedUntil: null },
    { config: { id: 'b', name: '校隊系統', url: 'https://example.com' }, health: 'warn', reasons: ['Supabase 回應異常'], mutedUntil: NOW + 3_600_000 },
    { config: { id: 'c', name: '專案控制台', url: 'https://example.org' }, health: 'ok', reasons: [], mutedUntil: null },
  ],
} as unknown as Overview;

describe('AI 輸入整理', () => {
  const input = buildAiInput(today, overview, NOW);

  it('包含行程、待辦、天氣、市場焦點、明天第一個行程', () => {
    expect(input).toContain('現在：11/26（週四）08:00');
    expect(input).toContain('台北 陣雨，18–23°，降雨機率 60%');
    expect(input).toContain('今日市場焦點：聯準會會議紀要偏鴿');
    expect(input).toContain('- 10:10–13:00 統計學（社科 101）');
    expect(input).toContain('- 整天 期中考週');
    expect(input).toContain('明天第一個行程：08:00 校隊練習');
    expect(input).toContain('- 15:59 統計作業三｜統計學｜作業｜高優先');
    expect(input).toContain('- 原訂 11/20 整理筆記');
    expect(input).toContain('- 11/30 經濟學報告｜經濟學｜報告');
  });

  it('只列出有異常、沒在維護時段的平台', () => {
    expect(input).toContain('平台異常：LiveLyrics：網站打不開');
    expect(input).not.toContain('校隊系統');
    expect(input).not.toContain('專案控制台');
  });

  it('不送出任何網址', () => {
    expect(input).not.toMatch(/https?:\/\//);
    expect(input).not.toContain('notion.so');
  });

  it('平台全部正常時明說', () => {
    expect(buildAiInput(today, { projects: [] } as unknown as Overview, NOW)).toContain('平台異常：沒有，全部正常');
  });

  it('舊的市場焦點不放進去', () => {
    const stale = { ...today, schedules: { data: [{ ...today.schedules.data![0], latestDate: '2026-11-25' }], error: null } };
    expect(buildAiInput(stale, null, NOW)).not.toContain('市場焦點');
  });
});

// ── 假的 Anthropic API ──

const answer = { headline: '統計課前把作業收尾', steps: [{ when: '10:10 前', action: '寫完統計作業三', why: '今晚 23:59 截止，課後就沒空' }] };

function apiFetch(opts: { status?: number; stop?: string; body?: unknown; calls?: { body: Record<string, unknown>; headers: Headers }[] } = {}) {
  return (async (_url: string, init: RequestInit) => {
    opts.calls?.push({ body: JSON.parse(String(init.body)), headers: new Headers(init.headers) });
    if (opts.status && opts.status >= 400)
      return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), {
        status: opts.status,
        headers: { 'content-type': 'application/json' },
      });
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-5-5',
        content: opts.stop === 'refusal' ? [] : [{ type: 'text', text: JSON.stringify(opts.body ?? answer) }],
        stop_reason: opts.stop ?? 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 150 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

describe('呼叫 Claude', () => {
  it('送出的請求：結構化輸出、低 effort、自動備援', async () => {
    const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
    const brief = await generateBrief('k', '輸入', '2026-11-26', NOW, apiFetch({ calls }));
    expect(brief).toMatchObject({ date: '2026-11-26', at: NOW, headline: answer.headline, steps: answer.steps, usage: { input: 900, output: 150 } });
    const { body, headers } = calls[0];
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.fallbacks).toBe('default');
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(body.messages).toEqual([{ role: 'user', content: '輸入' }]);
  });

  it('最多 3 步', async () => {
    const many = { headline: 'x', steps: Array.from({ length: 5 }, (_, i) => ({ when: `${i}`, action: 'a', why: 'b' })) };
    expect((await generateBrief('k', '', '2026-11-26', NOW, apiFetch({ body: many }))).steps).toHaveLength(3);
  });

  it('被拒絕、金鑰錯誤都變成可讀的錯誤', async () => {
    await expect(generateBrief('k', '', 'd', NOW, apiFetch({ stop: 'refusal' }))).rejects.toThrow(/拒絕/);
    await expect(generateBrief('k', '', 'd', NOW, apiFetch({ status: 401 }))).rejects.toThrow(AiError);
    await expect(generateBrief('k', '', 'd', NOW, apiFetch({ status: 401 }))).rejects.toThrow(/金鑰無效/);
  });
});

// ── 假的 D1：只處理 kv 表 ──

function fakeDb() {
  const rows = new Map<string, { v: string; ts: number }>();
  const db = {
    rows,
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind: (...a: unknown[]) => ((args = a), stmt),
        first: async () => (sql.startsWith('SELECT') ? (rows.get(String(args[0])) ?? null) : null),
        run: async () => {
          if (sql.startsWith('INSERT')) rows.set(String(args[0]), { v: String(args[1]), ts: Number(args[2]) });
          if (sql.startsWith('DELETE')) for (const k of [...rows.keys()]) if (k.startsWith('ai:') && k < String(args[0])) rows.delete(k);
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database & { rows: typeof rows };
}

describe('一天產生一次', () => {
  const input = async () => '輸入';

  it('沒設金鑰：不顯示、不呼叫', async () => {
    const r = await ensureBrief(fakeDb(), undefined, NOW, input);
    expect(r).toMatchObject({ configured: false, brief: null });
  });

  it('第一次產生後存起來，之後直接讀', async () => {
    const db = fakeDb();
    const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
    const f = apiFetch({ calls });
    const a = await ensureBrief(db, 'k', NOW, input, { fetchImpl: f });
    const b = await ensureBrief(db, 'k', NOW + 60_000, input, { fetchImpl: f });
    expect(a.brief?.headline).toBe(answer.headline);
    expect(b.brief?.at).toBe(NOW);
    expect(calls).toHaveLength(1);
    expect(a.regenerationsLeft).toBe(MAX_REGEN_PER_DAY);
  });

  it('只讀模式不呼叫 API', async () => {
    const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
    const r = await ensureBrief(fakeDb(), 'k', NOW, input, { readOnly: true, fetchImpl: apiFetch({ calls }) });
    expect(r).toMatchObject({ configured: true, brief: null });
    expect(calls).toHaveLength(0);
  });

  it('失敗後 30 分鐘內不自動重試，之後才再試', async () => {
    const db = fakeDb();
    const calls: { body: Record<string, unknown>; headers: Headers }[] = [];
    const bad = apiFetch({ status: 401, calls });
    const a = await ensureBrief(db, 'k', NOW, input, { fetchImpl: bad });
    expect(a).toMatchObject({ brief: null, error: expect.stringMatching(/金鑰無效/) });
    await ensureBrief(db, 'k', NOW + 10 * 60_000, input, { fetchImpl: bad });
    expect(calls).toHaveLength(1);
    const c = await ensureBrief(db, 'k', NOW + 31 * 60_000, input, { fetchImpl: apiFetch() });
    expect(c).toMatchObject({ error: null, brief: { headline: answer.headline } });
  });

  it(`重新產生每天最多 ${MAX_REGEN_PER_DAY} 次，失敗時保留原本那份`, async () => {
    const db = fakeDb();
    await ensureBrief(db, 'k', NOW, input, { fetchImpl: apiFetch() });
    for (let i = 1; i <= MAX_REGEN_PER_DAY; i++) {
      const r = await ensureBrief(db, 'k', NOW + i * 1000, input, { force: true, fetchImpl: i === 2 ? apiFetch({ status: 500 }) : apiFetch() });
      expect(r.regenerationsLeft).toBe(MAX_REGEN_PER_DAY - i);
      expect(r.brief?.headline).toBe(answer.headline);
      if (i === 2) expect(r.error).toBeTruthy();
    }
    await expect(ensureBrief(db, 'k', NOW + 9000, input, { force: true, fetchImpl: apiFetch() })).rejects.toThrow(AiLimitError);
  });

  it('隔天重新來過，舊的只留 7 天', async () => {
    const db = fakeDb();
    for (let d = 0; d < 10; d++) await ensureBrief(db, 'k', NOW + d * 86_400_000, input, { fetchImpl: apiFetch() });
    const keys = [...db.rows.keys()].sort();
    expect(keys[keys.length - 1]).toBe('ai:2026-12-05');
    expect(keys[0]).toBe('ai:2026-11-28');
  });
});
