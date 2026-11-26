// AI 今日重點：用 Claude 把行程、待辦、平台狀況整理成「今天先做」的 1～3 步。
// 一天產生一次（早上 7 點後的例行檢查、或第一次打開網站時），結果存在 D1；手動重新產生每天最多 5 次。

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AiBrief, AiBriefResponse, Overview, Today } from '../shared/types';
import { getKv, setKv } from './store';
import { addDays, ymdIn } from './time';

export const AI_MODEL = 'claude-sonnet-5-5';
export const MAX_REGEN_PER_DAY = 5;

const BriefSchema = z.object({
  headline: z.string().describe('一句話點出今天的重點或節奏，30 字以內'),
  steps: z
    .array(
      z.object({
        when: z.string().describe('時間點，例如「13:20 前」「練習前」「今晚」「有空再處理」'),
        action: z.string().describe('具體要做的事，20 字以內'),
        why: z.string().describe('一句理由，25 字以內'),
      }),
    )
    .describe('1 到 3 項，最優先的放第一個'),
});

const SYSTEM = `你是一位大學生的每日助理。使用者每天早上會看一份自己的簡報，你負責在簡報裡寫「今天先做」：根據提供的資料，排出今天最該先處理的事。

規則：
- 用繁體中文（台灣用語），語氣直接、像熟悉的朋友在提醒，不要客套。
- headline：一句話點出今天的重點或節奏，30 字以內。
- steps：1 到 3 項，依時間壓力和重要性排序。when 寫時間點，action 寫具體動作，why 寫一句理由。
- 有固定時間的考試或小考，提醒在那之前複習。有截止時間的待辦排在沒有時間的前面。
- 逾期很久的舊待辦不必全部列出，最多挑一件最該處理的，或乾脆不提。
- 平台只在有異常時才提；全部正常就不要提平台。
- 只根據提供的資料，不要捏造課程、地點、時間或任何細節；資料不夠就少列幾項。
- 使用者在同一頁已經看得到完整的行程與待辦清單，不要逐條重述，只挑出該先做的。`;

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const hm = (iso: string) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const ymdOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const WD = ['日', '一', '二', '三', '四', '五', '六'];

/** 把今天的資料整理成給模型看的純文字。不含網址、email 或任何金鑰。 */
export function buildAiInput(today: Today, overview: Overview | null, now: number): string {
  const lines: string[] = [];
  const wd = WD[new Date(`${today.date}T00:00:00Z`).getUTCDay()];
  lines.push(`現在：${md(today.date)}（週${wd}）${hm(new Date(now).toISOString())}`);

  const w = today.weather.data;
  if (w) lines.push(`天氣：${w.place} ${w.label}，${w.low}–${w.high}°${w.rain !== null ? `，降雨機率 ${w.rain}%` : ''}`);
  const brief = today.schedules.data?.find((s) => s.name === '晨間簡報');
  if (brief?.headline && brief.latestDate === today.date) lines.push(`今日市場焦點：${brief.headline}`);

  const events = today.calendar.data ?? [];
  const todays = events.filter((e) => (e.allDay ? e.start <= today.date && e.end > today.date : ymdOf(e.start) === today.date));
  lines.push('', '今天的行程：');
  if (!todays.length) lines.push('- （沒有）');
  for (const e of todays) lines.push(`- ${e.allDay ? '整天' : `${hm(e.start)}–${hm(e.end)}`} ${e.title}${e.location ? `（${e.location}）` : ''}`);
  const tomorrow = addDays(today.date, 1);
  const firstTomorrow = events.find((e) => (e.allDay ? e.start === tomorrow : ymdOf(e.start) === tomorrow));
  if (firstTomorrow) lines.push(`明天第一個行程：${firstTomorrow.allDay ? '整天' : hm(firstTomorrow.start)} ${firstTomorrow.title}`);

  const tasks = today.tasks.data ?? [];
  const fmt = (t: (typeof tasks)[number]) =>
    [
      t.due && t.due.length > 10 ? `${hm(t.due)} ` : '',
      t.title,
      t.courses[0] ? `｜${t.courses[0]}` : t.platform ? `｜${t.platform}` : '',
      t.type ? `｜${t.type.split(' ')[0]}` : '',
      t.priority?.startsWith('高') ? '｜高優先' : '',
    ].join('');
  const group = (label: string, list: typeof tasks, limit: number, prefix: (t: (typeof tasks)[number]) => string = () => '') => {
    if (!list.length) return;
    lines.push('', `${label}${list.length > limit ? `（共 ${list.length} 件，列出 ${limit} 件）` : ''}：`);
    for (const t of list.slice(0, limit)) lines.push(`- ${prefix(t)}${fmt(t)}`);
  };
  group('今天到期的待辦', tasks.filter((t) => t.bucket === 'today'), 10);
  group('逾期的待辦', tasks.filter((t) => t.bucket === 'overdue'), 5, (t) => (t.due ? `原訂 ${md(t.due.slice(0, 10))} ` : ''));
  group('7 天內到期的待辦', tasks.filter((t) => t.bucket === 'soon'), 6, (t) => (t.due ? `${md(t.due.slice(0, 10))} ` : ''));
  if (!tasks.length && !today.tasks.error) lines.push('', '待辦：（7 天內沒有到期的）');

  const bad = (overview?.projects ?? []).filter((p) => (p.health === 'down' || p.health === 'warn') && !p.mutedUntil);
  lines.push('', `平台異常：${bad.length ? bad.map((p) => `${p.config.name}：${p.reasons.join('、')}`).join('；') : '沒有，全部正常'}`);
  return lines.join('\n');
}

export class AiError extends Error {}

/** 呼叫 Claude 產生今天先做。fetchImpl 只給測試用。 */
export async function generateBrief(
  apiKey: string,
  input: string,
  date: string,
  now: number,
  fetchImpl?: typeof fetch,
): Promise<AiBrief> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 4000,
      // 被安全機制拒絕時，由 Anthropic 自動改用建議的備援模型重試
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(BriefSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: input }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('Anthropic API 金鑰無效，請重新設定 ANTHROPIC_API_KEY');
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Anthropic API 暫時限制請求次數，稍後再試');
    if (err instanceof Anthropic.APIError) {
      if (!err.status || err.status >= 500) throw new AiError(`Anthropic 服務暫時有問題（${err.status ?? '連不上'}），稍後再試`);
      const detail = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
      throw new AiError(`Anthropic API 回應 ${err.status}：${detail}`);
    }
    throw new AiError(err instanceof Error ? err.message : String(err));
  }
  if (res.stop_reason === 'refusal') throw new AiError('這次沒有產生建議（模型拒絕回答）');
  if (res.stop_reason === 'max_tokens') throw new AiError('回答被截斷，請重新產生');
  const out = res.parsed_output;
  if (!out || !out.headline) throw new AiError('回答格式不對，請重新產生');
  return {
    date,
    at: now,
    model: res.model,
    headline: out.headline.trim(),
    steps: out.steps.slice(0, 3).map((s) => ({ when: s.when.trim(), action: s.action.trim(), why: s.why.trim() })),
    regenerations: 0,
    usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
  };
}

// ── 存取與產生時機 ──────────────────────────────────────

interface Stored {
  brief: AiBrief | null;
  error: string | null;
  regenerations: number;
  /** 最後一次呼叫 API 的時間（不論成敗） */
  attemptAt: number;
  /** 正在產生中（避免排程和打開網頁同時各呼叫一次） */
  pendingAt: number | null;
}

/** 失敗後自動重試的間隔；手動「重新產生」不受限 */
const RETRY_AFTER_MS = 30 * 60_000;
const PENDING_MS = 2 * 60_000;
const KEEP_DAYS = 7;

const keyOf = (date: string) => `ai:${date}`;

export class AiLimitError extends Error {}

export interface AiOptions {
  /** 手動重新產生：今天已有建議也重做，每天最多 MAX_REGEN_PER_DAY 次 */
  force?: boolean;
  /** 只讀現有的，不呼叫 API */
  readOnly?: boolean;
  fetchImpl?: typeof fetch;
}

function view(s: Stored | null, configured: boolean, pending = false): AiBriefResponse {
  return {
    configured,
    brief: s?.brief ?? null,
    error: s?.error ?? null,
    regenerationsLeft: Math.max(0, MAX_REGEN_PER_DAY - (s?.regenerations ?? 0)),
    pending,
  };
}

/**
 * 取得今天的建議；還沒有就產生一份。
 * makeInput 只在真的要呼叫 API 時才執行（要讀 Notion、行事曆，比較慢）。
 */
export async function ensureBrief(
  db: D1Database,
  apiKey: string | undefined,
  now: number,
  makeInput: () => Promise<string>,
  opts: AiOptions = {},
): Promise<AiBriefResponse> {
  const date = ymdIn(now);
  const key = keyOf(date);
  const stored = (await getKv<Stored>(db, key))?.v ?? null;
  if (!apiKey) return view(null, false);
  const pending = !!stored?.pendingAt && now - stored.pendingAt < PENDING_MS;

  if (opts.force) {
    if ((stored?.regenerations ?? 0) >= MAX_REGEN_PER_DAY) throw new AiLimitError(`今天已經重新產生 ${MAX_REGEN_PER_DAY} 次了，明天再試`);
    if (pending) return view(stored, true, true);
  } else {
    if (opts.readOnly || stored?.brief || pending) return view(stored, true, pending);
    if (stored?.error && now - stored.attemptAt < RETRY_AFTER_MS) return view(stored, true);
  }

  const base: Stored = stored ?? { brief: null, error: null, regenerations: 0, attemptAt: 0, pendingAt: null };
  await setKv(db, key, { ...base, pendingAt: now }, now);
  const regenerations = base.regenerations + (opts.force ? 1 : 0);
  let next: Stored;
  try {
    const brief = await generateBrief(apiKey, await makeInput(), date, now, opts.fetchImpl);
    next = { brief: { ...brief, regenerations }, error: null, regenerations, attemptAt: now, pendingAt: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('AI brief failed', message);
    // 重新產生失敗時保留原本那份
    next = { brief: base.brief, error: message, regenerations, attemptAt: now, pendingAt: null };
  }
  await setKv(db, key, next, now);
  // 只留最近 7 天
  await db.prepare("DELETE FROM kv WHERE k LIKE 'ai:%' AND k < ?").bind(keyOf(addDays(date, -KEEP_DAYS))).run();
  return view(next, true);
}
