// 異常通知：用 Resend 寄 email。
// 規則：網站或 Supabase 連續兩次檢查失敗（每次檢查本身已重試過）才算異常並通知；
// 恢復時再通知一次，附上中斷多久；同一件事在恢復前不重複寄。
// 每次異常的起訖時間存在 incidents 表，詳細頁會用到。

type Fetch = typeof fetch;

export interface AlertEnv {
  RESEND_API_KEY?: string;
  NOTIFY_EMAIL?: string;
}

export interface Signal {
  /** 例如 site:bafinstat、supabase:bafinstat、domain:bafinstat */
  key: string;
  project: string | null;
  label: string;
  /** 這一次檢查失敗 */
  failing: boolean;
  /** 上一次檢查也失敗（用來判斷「連續兩次」）；網域這類不需要確認的訊號給 true */
  prevFailing: boolean;
  /** 異常時的說明 */
  detail: string;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS incidents (
     key TEXT NOT NULL,
     project TEXT,
     label TEXT NOT NULL,
     detail TEXT,
     opened_at INTEGER NOT NULL,
     closed_at INTEGER
   )`,
  `CREATE INDEX IF NOT EXISTS incidents_open ON incidents (key, closed_at)`,
  `CREATE INDEX IF NOT EXISTS incidents_project ON incidents (project, opened_at)`,
];

let ready: Promise<unknown> | null = null;
export function ensureIncidents(db: D1Database): Promise<unknown> {
  ready ??= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export function duration(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h} 小時 ${rest} 分鐘` : `${h} 小時`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} 天 ${h % 24} 小時` : `${d} 天`;
}

const taipeiTime = (ms: number) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

export interface Mail {
  subject: string;
  text: string;
}

export interface Transition {
  kind: 'open' | 'close';
  signal: Signal;
  openedAt: number;
}

/** 依目前的訊號開關異常紀錄，回傳這次有變化的項目。 */
export async function processSignals(db: D1Database, signals: Signal[], now: number): Promise<Transition[]> {
  await ensureIncidents(db);
  const { results: open } = await db
    .prepare('SELECT rowid AS id, key, opened_at FROM incidents WHERE closed_at IS NULL')
    .all<{ id: number; key: string; opened_at: number }>();
  const openByKey = new Map(open.map((o) => [o.key, o]));
  const changes: Transition[] = [];
  const stmts: D1PreparedStatement[] = [];

  for (const s of signals) {
    const current = openByKey.get(s.key);
    if (!current && s.failing && s.prevFailing) {
      stmts.push(
        db.prepare('INSERT INTO incidents (key, project, label, detail, opened_at) VALUES (?, ?, ?, ?, ?)').bind(s.key, s.project, s.label, s.detail, now),
      );
      changes.push({ kind: 'open', signal: s, openedAt: now });
    } else if (current && !s.failing) {
      stmts.push(db.prepare('UPDATE incidents SET closed_at = ? WHERE rowid = ?').bind(now, current.id));
      changes.push({ kind: 'close', signal: s, openedAt: current.opened_at });
    }
  }
  // 平台被刪掉或暫停後，它還開著的異常默默關掉，不寄信
  const live = new Set(signals.map((s) => s.key));
  for (const o of open) if (!live.has(o.key)) stmts.push(db.prepare('UPDATE incidents SET closed_at = ? WHERE rowid = ?').bind(now, o.id));
  // 只留 90 天
  stmts.push(db.prepare('DELETE FROM incidents WHERE closed_at IS NOT NULL AND closed_at < ?').bind(now - 90 * 86_400_000));
  await db.batch(stmts);
  return changes;
}

/** 把一次檢查裡的所有變化合成一封信，避免一次寄好幾封。 */
export function composeMail(changes: Transition[], now: number, siteUrl: string): Mail | null {
  if (!changes.length) return null;
  const opened = changes.filter((c) => c.kind === 'open');
  const closed = changes.filter((c) => c.kind === 'close');
  const names = (list: Transition[]) => [...new Set(list.map((c) => c.signal.label))].join('、');

  const subject = opened.length
    ? `【異常】${names(opened)}${closed.length ? `；【恢復】${names(closed)}` : ''}`
    : `【恢復】${names(closed)}`;

  const lines: string[] = [];
  if (opened.length) {
    lines.push('發現異常：');
    for (const c of opened) lines.push(`・${c.signal.label}：${c.signal.detail}`);
    lines.push('');
  }
  if (closed.length) {
    lines.push('已經恢復：');
    for (const c of closed) lines.push(`・${c.signal.label}：中斷 ${duration(now - c.openedAt)}（${taipeiTime(c.openedAt)} 起）`);
    lines.push('');
  }
  lines.push(`檢查時間：${taipeiTime(now)}（台北）`);
  lines.push(`控制台：${siteUrl}`);
  lines.push('');
  lines.push('同一件事在恢復前不會重複通知。');
  return { subject, text: lines.join('\n') };
}

export interface SendResult {
  ok: boolean;
  error: string | null;
}

export async function sendMail(env: AlertEnv, mail: Mail, f: Fetch = fetch): Promise<SendResult> {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return { ok: false, error: '還沒設定 RESEND_API_KEY 或 NOTIFY_EMAIL' };
  try {
    const res = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: '專案控制台 <onboarding@resend.dev>',
        to: [env.NOTIFY_EMAIL],
        subject: mail.subject,
        text: mail.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true, error: null };
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    if (res.status === 401 || res.status === 403)
      return { ok: false, error: `Resend 拒絕寄送（HTTP ${res.status}）：${body.message ?? '金鑰無效，或收件信箱不是你註冊 Resend 用的信箱'}` };
    return { ok: false, error: `Resend 回應 HTTP ${res.status}${body.message ? `：${body.message}` : ''}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
