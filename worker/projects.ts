// 平台清單：存在 D1，網站的設定頁可以新增、編輯、排序、暫停監控。
// 第一次使用時把 projects.json 匯入當作預設值，之後以資料庫為準。

import registryJson from '../projects.json';
import type { Host, ProjectConfig, Registry } from '../shared/types';

const seed = registryJson as Registry;
export const OWNER = seed.owner;

export interface StoredProject extends ProjectConfig {
  paused: boolean;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  position INTEGER NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0
)`;

let ready: Promise<void> | null = null;

/** 建表；表是空的時候匯入 projects.json。 */
export function ensureProjects(db: D1Database): Promise<void> {
  ready ??= (async () => {
    await db.prepare(SCHEMA).run();
    const row = await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>();
    if ((row?.n ?? 0) === 0) {
      const stmt = db.prepare('INSERT OR IGNORE INTO projects (id, data, position, paused) VALUES (?, ?, ?, 0)');
      await db.batch(seed.projects.map((p, i) => stmt.bind(p.id, JSON.stringify(p), i)));
    }
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export async function listProjects(db: D1Database): Promise<StoredProject[]> {
  await ensureProjects(db);
  const { results } = await db
    .prepare('SELECT data, paused FROM projects ORDER BY position, id')
    .all<{ data: string; paused: number }>();
  return results.map((r) => ({ ...(JSON.parse(r.data) as ProjectConfig), paused: r.paused === 1 }));
}

/** 要監控的平台（不含暫停的）。 */
export async function activeProjects(db: D1Database): Promise<ProjectConfig[]> {
  return (await listProjects(db)).filter((p) => !p.paused).map(({ paused: _p, ...p }) => p);
}

export class ValidationError extends Error {}

const HOSTS: Host[] = ['vercel', 'cloudflare', 'github-pages'];

function optionalString(v: unknown, field: string, max = 300): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new ValidationError(`${field} 格式不對`);
  const t = v.trim();
  if (t.length > max) throw new ValidationError(`${field} 太長了`);
  return t || undefined;
}

function httpsUrl(v: string | undefined, field: string): string | undefined {
  if (!v) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ValidationError(`${field} 不是有效的網址`);
  }
  if (u.protocol !== 'https:') throw new ValidationError(`${field} 要用 https:// 開頭`);
  return u.toString();
}

/** 檢查並整理從設定頁送來的平台資料。 */
export function validateProject(input: unknown): StoredProject {
  if (!input || typeof input !== 'object') throw new ValidationError('資料格式不對');
  const o = input as Record<string, unknown>;

  const id = optionalString(o.id, '代號', 40);
  if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new ValidationError('代號只能用小寫英文、數字和 -，例如 my-app');
  const name = optionalString(o.name, '名稱', 60);
  if (!name) throw new ValidationError('請填名稱');
  const repo = optionalString(o.repo, 'GitHub repo', 100);
  if (!repo || !/^[A-Za-z0-9._-]+$/.test(repo)) throw new ValidationError('GitHub repo 只填名稱就好，例如 bafinstat');
  const host = o.host as Host;
  if (!HOSTS.includes(host)) throw new ValidationError('主機要選 Vercel、Cloudflare 或 GitHub Pages');

  const supabase = optionalString(o.supabase, 'Supabase 代號', 40);
  if (supabase && !/^[a-z0-9]{20}$/.test(supabase))
    throw new ValidationError('Supabase 代號是網址 https://xxxx.supabase.co 裡那 20 個小寫英數字');
  const domain = optionalString(o.domain, '自訂網域', 253)?.toLowerCase();
  if (domain && !/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain))
    throw new ValidationError('自訂網域格式不對，例如 ntubafin.tw（不要加 https://）');

  let okStatus: number[] | undefined;
  if (Array.isArray(o.okStatus) && o.okStatus.length) {
    okStatus = o.okStatus.map(Number);
    if (okStatus.some((n) => !Number.isInteger(n) || n < 100 || n > 599)) throw new ValidationError('允許的狀態碼要是 100～599 的數字');
  }

  const notes = httpsUrl(optionalString(o.notes, 'Notion 筆記連結', 500), 'Notion 筆記連結');
  if (notes && !/(^|\.)notion\.(so|site|com)$/.test(new URL(notes).hostname))
    throw new ValidationError('筆記連結要是 Notion 的網址');

  return {
    id,
    name,
    summary: optionalString(o.summary, '一句話說明', 60) ?? '',
    repo,
    url: httpsUrl(optionalString(o.url, '網址', 500), '網址') ?? null,
    host,
    ...(supabase ? { supabase } : {}),
    ...(domain ? { domain } : {}),
    ...(okStatus ? { okStatus } : {}),
    ...(notes ? { notes } : {}),
    paused: o.paused === true,
  };
}

const MAX_PROJECTS = 40;

export async function createProject(db: D1Database, p: StoredProject): Promise<void> {
  await ensureProjects(db);
  const row = await db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS last FROM projects').first<{ n: number; last: number }>();
  if ((row?.n ?? 0) >= MAX_PROJECTS) throw new ValidationError(`最多 ${MAX_PROJECTS} 個平台`);
  const { paused, ...data } = p;
  const res = await db
    .prepare('INSERT OR IGNORE INTO projects (id, data, position, paused) VALUES (?, ?, ?, ?)')
    .bind(p.id, JSON.stringify(data), (row?.last ?? -1) + 1, paused ? 1 : 0)
    .run();
  if (!res.meta.changes) throw new ValidationError(`代號「${p.id}」已經有人用了`);
}

export async function updateProject(db: D1Database, id: string, p: StoredProject): Promise<void> {
  await ensureProjects(db);
  if (p.id !== id) throw new ValidationError('代號建立後不能改');
  const { paused, ...data } = p;
  const res = await db
    .prepare('UPDATE projects SET data = ?, paused = ? WHERE id = ?')
    .bind(JSON.stringify(data), paused ? 1 : 0, id)
    .run();
  if (!res.meta.changes) throw new ValidationError('找不到這個平台');
}

export async function deleteProject(db: D1Database, id: string): Promise<void> {
  await ensureProjects(db);
  await db.batch([
    db.prepare('DELETE FROM projects WHERE id = ?').bind(id),
    db.prepare('DELETE FROM checks WHERE project = ?').bind(id),
  ]);
}

/** 依傳入的順序重排；沒列到的維持在後面。 */
export async function reorderProjects(db: D1Database, ids: unknown): Promise<void> {
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw new ValidationError('排序資料格式不對');
  await ensureProjects(db);
  const stmt = db.prepare('UPDATE projects SET position = ? WHERE id = ?');
  await db.batch((ids as string[]).map((id, i) => stmt.bind(i, id)));
}
