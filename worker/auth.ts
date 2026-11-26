// 密碼登入：一組密碼（Cloudflare Secret DASHBOARD_PASSWORD），登入後發一個簽章過的 cookie。
// 簽章金鑰由密碼推導，所以改密碼會讓所有已登入的裝置一起登出。

export const COOKIE_NAME = 'ld_session';
export const SESSION_MS = 30 * 86_400_000;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 15 * 60_000;

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sessionKey(password: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`life-dashboard/session/v1:${password}`));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** 產生 cookie 值：v1.<到期時間>.<簽章> */
export async function createSession(password: string, now: number): Promise<string> {
  const payload = `v1.${now + SESSION_MS}`;
  const sig = await crypto.subtle.sign('HMAC', await sessionKey(password), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function verifySession(password: string, value: string | null, now: number): Promise<boolean> {
  if (!value) return false;
  const m = /^v1\.(\d{10,16})\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!m) return false;
  if (Number(m[1]) <= now) return false;
  const sig = fromB64url(m[2]);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', await sessionKey(password), sig, enc.encode(`v1.${m[1]}`));
}

/** 比對密碼：先各自雜湊成固定長度再逐位元比，花的時間不會透露猜對幾個字。 */
export async function passwordMatches(input: string, password: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(input)),
    crypto.subtle.digest('SHA-256', enc.encode(password)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MS / 1000}`;
}

export const clearCookie = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** POST 只接受同一個網站送來的，擋掉別的網站偷偷代替你按按鈕。 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  return origin === null || origin === new URL(req.url).origin;
}

// 登入失敗次數，存在 D1，每個 IP 15 分鐘內最多錯 10 次
export async function recentFailures(db: D1Database, ip: string, now: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?')
    .bind(ip, now - FAILURE_WINDOW_MS)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordFailure(db: D1Database, ip: string, now: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').bind(ip, now),
    db.prepare('DELETE FROM login_failures WHERE ts <= ?').bind(now - FAILURE_WINDOW_MS),
  ]);
}

export async function clearFailures(db: D1Database, ip: string): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
}
