import { describe, expect, it } from 'vitest';
import {
  COOKIE_NAME,
  createSession,
  passwordMatches,
  readCookie,
  sameOrigin,
  SESSION_MS,
  sessionCookie,
  verifySession,
} from '../worker/auth';

const PW = 'correct horse battery';
const NOW = Date.parse('2026-11-26T12:00:00Z');

describe('登入 cookie', () => {
  it('自己簽的 cookie 驗得過', async () => {
    const v = await createSession(PW, NOW);
    expect(v).toMatch(/^v1\.\d+\.[A-Za-z0-9_-]+$/);
    expect(await verifySession(PW, v, NOW + 1000)).toBe(true);
  });

  it('30 天後過期', async () => {
    const v = await createSession(PW, NOW);
    expect(await verifySession(PW, v, NOW + SESSION_MS - 1)).toBe(true);
    expect(await verifySession(PW, v, NOW + SESSION_MS)).toBe(false);
  });

  it('改密碼之後舊的 cookie 全部失效', async () => {
    const v = await createSession(PW, NOW);
    expect(await verifySession('another password!!', v, NOW)).toBe(false);
  });

  it('竄改到期時間或簽章都會被擋', async () => {
    const v = await createSession(PW, NOW);
    const [, exp, sig] = v.split('.');
    expect(await verifySession(PW, `v1.${Number(exp) + SESSION_MS}.${sig}`, NOW)).toBe(false);
    expect(await verifySession(PW, `v1.${exp}.${sig.slice(0, -2)}AA`, NOW)).toBe(false);
  });

  it('空的或格式不對的 cookie 不算登入', async () => {
    for (const bad of [null, '', 'v1', 'v1.abc.def', 'v2.9999999999999.x', 'v1.9999999999999.!!!'])
      expect(await verifySession(PW, bad, NOW)).toBe(false);
  });

  it('cookie 屬性：HttpOnly、Secure、SameSite', () => {
    const c = sessionCookie('x');
    expect(c).toContain(`${COOKIE_NAME}=x`);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
  });
});

describe('密碼比對', () => {
  it('完全一樣才算對', async () => {
    expect(await passwordMatches(PW, PW)).toBe(true);
    expect(await passwordMatches(`${PW} `, PW)).toBe(false);
    expect(await passwordMatches('', PW)).toBe(false);
  });
});

describe('請求檢查', () => {
  it('從 cookie 標頭讀出指定的值', () => {
    const req = new Request('https://x.test/', { headers: { cookie: `a=1; ${COOKIE_NAME}=v1.2.abc; b=2` } });
    expect(readCookie(req, COOKIE_NAME)).toBe('v1.2.abc');
    expect(readCookie(new Request('https://x.test/'), COOKIE_NAME)).toBeNull();
  });

  it('擋掉其他網站送來的 POST', () => {
    const post = (origin?: string) =>
      new Request('https://dash.test/api/run', { method: 'POST', headers: origin ? { origin } : {} });
    expect(sameOrigin(post('https://dash.test'))).toBe(true);
    expect(sameOrigin(post())).toBe(true);
    expect(sameOrigin(post('https://evil.test'))).toBe(false);
  });
});
