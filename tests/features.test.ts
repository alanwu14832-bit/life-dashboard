import { describe, expect, it } from 'vitest';
import { createTask, fetchSchedules, SOURCES } from '../worker/notion';
import { validateProject } from '../worker/projects';
import { fetchWeather, weatherLabel } from '../worker/weather';
import { composeWeeklyMail } from '../worker/weekly';
import type { Weekly } from '../shared/types';

const jsonFetch = (handler: (url: string, init: RequestInit) => unknown, status = 200) =>
  (async (url: string, init: RequestInit = {}) => new Response(JSON.stringify(handler(String(url), init)), { status })) as unknown as typeof fetch;

describe('天氣', () => {
  it('天氣代碼轉中文', () => {
    expect(weatherLabel(0)).toBe('晴');
    expect(weatherLabel(3)).toBe('陰');
    expect(weatherLabel(63)).toBe('下雨');
    expect(weatherLabel(81)).toBe('陣雨');
    expect(weatherLabel(95)).toBe('雷雨');
  });
  it('整理 Open-Meteo 回應：現在溫度、高低溫、降雨機率', async () => {
    const f = jsonFetch(() => ({
      current: { temperature_2m: 21.6, weather_code: 3 },
      daily: { temperature_2m_max: [24.4], temperature_2m_min: [17.5], precipitation_probability_max: [40], weather_code: [61] },
    }));
    expect(await fetchWeather(f, 1)).toEqual({ place: '台北', now: 22, high: 24, low: 18, rain: 40, label: '下雨' });
  });
});

describe('快速新增待辦', () => {
  it('送到 Notion 的內容：標題、未開始、截止日', async () => {
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const f = jsonFetch((url, init) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return { id: 'new-id', url: 'https://www.notion.so/new' };
    });
    expect(await createTask('t', '  繳交報名表  ', '2026-11-27', f)).toEqual({ id: 'new-id', url: 'https://www.notion.so/new' });
    expect(sent!.url).toBe('https://api.notion.com/v1/pages');
    expect(sent!.body).toEqual({
      parent: { type: 'data_source_id', data_source_id: SOURCES.tasks },
      properties: {
        '待辦 Task': { title: [{ text: { content: '繳交報名表' } }] },
        '狀態 Status': { select: { name: '未開始 Not Started' } },
        '截止日 Due': { date: { start: '2026-11-27' } },
      },
    });
  });
  it('不設日期就不送截止日；空白或格式不對直接擋下', async () => {
    let body: Record<string, Record<string, unknown>> | null = null;
    const f = jsonFetch((_u, init) => ((body = JSON.parse(String(init.body))), { id: 'x', url: 'u' }));
    await createTask('t', '想一想', null, f);
    expect(body!.properties['截止日 Due']).toBeUndefined();
    await expect(createTask('t', '   ', null, f)).rejects.toThrow('請輸入');
    await expect(createTask('t', 'x', '11/27', f)).rejects.toThrow('日期格式');
  });
});

describe('晨間簡報與台股收盤的重點', () => {
  it('帶出今日焦點、加權指數與方向', async () => {
    const f = jsonFetch((url) => {
      const page = (props: Record<string, unknown>) => ({ results: [{ id: 'p', url: 'https://www.notion.so/p', created_time: '', properties: { '日期 Date': { type: 'date', date: { start: '2026-11-26' } }, ...props } }] });
      if (url.includes(SOURCES.briefing))
        return page({ '今日焦點 Headline': { type: 'rich_text', rich_text: [{ plain_text: 'Fed 會議紀要偏鴿' }] }, '市場氛圍 Tone': { type: 'select', select: { name: '風險偏好上升' } } });
      return page({
        '今日焦點 Headline': { type: 'rich_text', rich_text: [{ plain_text: '台積電法說前夕' }] },
        收盤指數: { type: 'number', number: 23456.78 },
        '漲跌幅 %': { type: 'number', number: 1.47 },
        方向: { type: 'select', select: { name: '🔴 上漲' } },
      });
    });
    const [brief, tw] = await fetchSchedules('t', '2026-11-26', Date.parse('2026-11-26T19:00:00+08:00'), f);
    expect(brief).toMatchObject({ headline: 'Fed 會議紀要偏鴿', figure: '風險偏好上升', direction: null });
    expect(tw).toMatchObject({ headline: '台積電法說前夕', figure: '加權指數 23,456.78，+1.47%', direction: 'up' });
  });
});

describe('週報信', () => {
  it('標題與內容', () => {
    const w: Weekly = {
      from: '2026-11-20',
      to: '2026-11-26',
      done: { data: [{ title: '會計小考', url: 'u1', date: '2026-11-26' }, { title: '統計作業', url: 'u2', date: '2026-11-24' }], error: null },
      platforms: [
        { id: 'a', name: 'NTU BaFiN Stats', uptime: 1, commits: 12, incidents: 0 },
        { id: 'b', name: 'Livelyrics', uptime: 0.987, commits: 3, incidents: 1 },
      ],
      notes: { data: [{ title: '個人儀表板決策', url: 'n' }], error: null },
      nextWeek: { data: { events: 9, tasks: 4 }, error: null },
    };
    const m = composeWeeklyMail(w, 'https://dash.test/');
    expect(m.subject).toBe('【週報】11/20–11/26：完成 2 件待辦');
    expect(m.text).toContain('・NTU BaFiN Stats：100% · 12 次 commit · 沒有異常');
    expect(m.text).toContain('・Livelyrics：98.7% · 3 次 commit · 異常 1 次');
    expect(m.text).toContain('【下週】9 個行程、4 件待辦到期');
    expect(m.text).toContain('https://dash.test/#week');
  });
});

describe('主機後台網址', () => {
  const base = { id: 'x', name: 'X', repo: 'x', host: 'vercel' };
  it('要是 https 網址', () => {
    expect(validateProject({ ...base, adminUrl: 'https://vercel.com/me/x' }).adminUrl).toBe('https://vercel.com/me/x');
    expect(() => validateProject({ ...base, adminUrl: 'vercel.com' })).toThrow('主機後台網址');
  });
});
