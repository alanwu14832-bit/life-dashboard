import type { CheckKind, CheckResult, CheckRow } from '../shared/types';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS checks (
     project TEXT NOT NULL,
     kind TEXT NOT NULL,
     ts INTEGER NOT NULL,
     ok INTEGER NOT NULL,
     status INTEGER,
     ms INTEGER,
     error TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS checks_project_kind_ts ON checks (project, kind, ts)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS login_failures_ip_ts ON login_failures (ip, ts)`,
];

const RETENTION_MS = 30 * 86_400_000;

let schemaReady: Promise<unknown> | null = null;

/** 第一次用到資料庫時自動建表，不需要手動跑 migration。 */
export function ensureSchema(db: D1Database): Promise<unknown> {
  schemaReady ??= db.batch(SCHEMA.map((s) => db.prepare(s))).catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

export async function insertChecks(
  db: D1Database,
  ts: number,
  rows: { project: string; kind: CheckKind; result: CheckResult }[],
): Promise<void> {
  if (!rows.length) return;
  const stmt = db.prepare('INSERT INTO checks (project, kind, ts, ok, status, ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)');
  await db.batch([
    ...rows.map((r) =>
      stmt.bind(r.project, r.kind, ts, r.result.ok ? 1 : 0, r.result.status, r.result.ms, r.result.error),
    ),
    db.prepare('DELETE FROM checks WHERE ts < ?').bind(ts - RETENTION_MS),
  ]);
}

export async function getKv<T>(db: D1Database, k: string): Promise<{ v: T; ts: number } | null> {
  const row = await db.prepare('SELECT v, ts FROM kv WHERE k = ?').bind(k).first<{ v: string; ts: number }>();
  return row ? { v: JSON.parse(row.v) as T, ts: row.ts } : null;
}

export async function setKv(db: D1Database, k: string, v: unknown, ts: number): Promise<void> {
  await db
    .prepare('INSERT INTO kv (k, v, ts) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, ts = excluded.ts')
    .bind(k, JSON.stringify(v), ts)
    .run();
}

interface RawRow {
  project: string;
  kind: CheckKind;
  ts: number;
  ok: number;
  status: number | null;
  ms: number | null;
  error: string | null;
}

const toRow = (r: RawRow): CheckRow => ({ ...r, ok: r.ok === 1 });

export interface CheckSummary {
  latest: Map<string, CheckRow>;
  uptime: Map<string, { d1: number | null; d7: number | null }>;
  recent: Map<string, { ts: number; ok: boolean; ms: number | null }[]>;
}

const key = (project: string, kind: CheckKind) => `${project}:${kind}`;

/** 一次讀出每個專案的最新結果、24 小時與 7 天可用率、24 小時內的逐次紀錄。 */
export async function summarize(db: D1Database, now: number): Promise<CheckSummary> {
  const d1 = now - 86_400_000;
  const d7 = now - 7 * 86_400_000;
  const [latestRes, uptimeRes, recentRes] = await db.batch<RawRow & { n1: number; up1: number; n7: number; up7: number }>([
    db.prepare(
      `SELECT project, kind, ts, ok, status, ms, error FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY project, kind ORDER BY ts DESC) AS rn FROM checks
       ) WHERE rn = 1`,
    ),
    db
      .prepare(
        `SELECT project, kind,
           SUM(CASE WHEN ts >= ?1 THEN 1 ELSE 0 END) AS n1,
           SUM(CASE WHEN ts >= ?1 THEN ok ELSE 0 END) AS up1,
           COUNT(*) AS n7,
           SUM(ok) AS up7
         FROM checks WHERE ts >= ?2 GROUP BY project, kind`,
      )
      .bind(d1, d7),
    db.prepare(`SELECT project, kind, ts, ok, ms FROM checks WHERE kind = 'http' AND ts >= ? ORDER BY ts`).bind(d1),
  ]);

  const latest = new Map<string, CheckRow>();
  for (const r of latestRes.results) latest.set(key(r.project, r.kind), toRow(r));

  const uptime = new Map<string, { d1: number | null; d7: number | null }>();
  for (const r of uptimeRes.results)
    uptime.set(key(r.project, r.kind), {
      d1: r.n1 ? r.up1 / r.n1 : null,
      d7: r.n7 ? r.up7 / r.n7 : null,
    });

  const recent = new Map<string, { ts: number; ok: boolean; ms: number | null }[]>();
  for (const r of recentRes.results) {
    const list = recent.get(r.project) ?? [];
    list.push({ ts: r.ts, ok: r.ok === 1, ms: r.ms });
    recent.set(r.project, list);
  }

  return { latest, uptime, recent };
}

export { key as checkKey };

/** 單一平台的歷史：30 天每日可用率、7 天每小時回應時間。 */
export async function projectHistory(db: D1Database, project: string, now: number) {
  const DAY = 86_400_000;
  const TZ_OFFSET = 8 * 3_600_000; // 台北
  const todayIdx = Math.floor((now + TZ_OFFSET) / DAY);
  const since30 = (todayIdx - 29) * DAY - TZ_OFFSET;
  const since7 = now - 7 * DAY;
  const [daily, hourly] = await db.batch<{ k: number; n: number; up: number; avg: number | null }>([
    db
      .prepare(
        // 綁定的參數可能被當成小數，所以明確轉成整數再除
        `SELECT CAST((ts + CAST(?1 AS INTEGER)) / CAST(?2 AS INTEGER) AS INTEGER) AS k, COUNT(*) AS n, SUM(ok) AS up, NULL AS avg
         FROM checks WHERE project = ?3 AND kind = 'http' AND ts >= ?4 GROUP BY k`,
      )
      .bind(TZ_OFFSET, DAY, project, since30),
    db
      .prepare(
        `SELECT CAST(ts / 3600000 AS INTEGER) AS k, COUNT(*) AS n, SUM(ok) AS up, AVG(CASE WHEN ok = 1 THEN ms END) AS avg
         FROM checks WHERE project = ? AND kind = 'http' AND ts >= ? GROUP BY k`,
      )
      .bind(project, since7),
  ]);
  const byDay = new Map(daily.results.map((r) => [r.k, r]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const k = todayIdx - 29 + i;
    const r = byDay.get(k);
    return {
      date: new Date(k * DAY).toISOString().slice(0, 10),
      uptime: r && r.n ? r.up / r.n : null,
      checks: r?.n ?? 0,
    };
  });
  const byHour = new Map(hourly.results.map((r) => [r.k, r]));
  const firstHour = Math.floor(since7 / 3_600_000) + 1;
  const latency = Array.from({ length: 168 }, (_, i) => {
    const k = firstHour + i;
    const r = byHour.get(k);
    return { ts: k * 3_600_000, ms: r?.avg != null ? Math.round(r.avg) : null, down: !!r && r.up < r.n };
  });
  const total = daily.results.reduce((a, r) => a + r.n, 0);
  const up = daily.results.reduce((a, r) => a + r.up, 0);
  return { days, latency, uptime30d: total ? up / total : null };
}
