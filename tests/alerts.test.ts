import { describe, expect, it } from 'vitest';
import { composeMail, duration, sendMail, type Signal, type Transition } from '../worker/alerts';

const sig = (over: Partial<Signal> = {}): Signal => ({
  key: 'site:bafinstat', project: 'bafinstat', label: 'NTU BaFiN Stats 網站', failing: true, prevFailing: true, detail: '打不開（HTTP 503）', ...over,
});
const NOW = Date.parse('2026-11-26T20:00:00+08:00');

describe('通知信內容', () => {
  it('沒有變化就不寄', () => {
    expect(composeMail([], NOW, 'https://x')).toBeNull();
  });
  it('異常與恢復合成一封，標題列出兩邊', () => {
    const changes: Transition[] = [
      { kind: 'open', signal: sig(), openedAt: NOW },
      { kind: 'close', signal: sig({ key: 'supabase:ntubastat', label: 'NTUBT Stats 的 Supabase', failing: false }), openedAt: NOW - 70 * 60_000 },
    ];
    const mail = composeMail(changes, NOW, 'https://dash.test')!;
    expect(mail.subject).toBe('【異常】NTU BaFiN Stats 網站；【恢復】NTUBT Stats 的 Supabase');
    expect(mail.text).toContain('・NTU BaFiN Stats 網站：打不開（HTTP 503）');
    expect(mail.text).toContain('・NTUBT Stats 的 Supabase：中斷 1 小時 10 分鐘');
    expect(mail.text).toContain('https://dash.test');
  });
  it('只有恢復', () => {
    const mail = composeMail([{ kind: 'close', signal: sig({ failing: false }), openedAt: NOW - 5 * 60_000 }], NOW, 'x')!;
    expect(mail.subject).toBe('【恢復】NTU BaFiN Stats 網站');
  });
  it('中斷時間的寫法', () => {
    expect(duration(30_000)).toBe('1 分鐘');
    expect(duration(45 * 60_000)).toBe('45 分鐘');
    expect(duration(2 * 3_600_000)).toBe('2 小時');
    expect(duration(26 * 3_600_000)).toBe('1 天 2 小時');
  });
});

describe('寄信', () => {
  const mail = { subject: 's', text: 't' };
  it('沒設定金鑰時不呼叫 Resend', async () => {
    let called = false;
    const f = (async () => ((called = true), new Response('{}'))) as unknown as typeof fetch;
    expect(await sendMail({}, mail, f)).toMatchObject({ ok: false });
    expect(called).toBe(false);
  });
  it('送到 Resend 的內容', async () => {
    let req: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => ((req = { url, init }), new Response('{"id":"x"}'))) as unknown as typeof fetch;
    expect(await sendMail({ RESEND_API_KEY: 're_x', NOTIFY_EMAIL: 'me@example.com' }, mail, f)).toEqual({ ok: true, error: null });
    expect(req!.url).toBe('https://api.resend.com/emails');
    expect((req!.init.headers as Record<string, string>).authorization).toBe('Bearer re_x');
    expect(JSON.parse(String(req!.init.body))).toEqual({ from: '專案控制台 <onboarding@resend.dev>', to: ['me@example.com'], subject: 's', text: 't' });
  });
  it('Resend 拒絕時說明可能原因', async () => {
    const f = (async () => new Response('{"message":"You can only send testing emails to your own email address"}', { status: 403 })) as unknown as typeof fetch;
    const r = await sendMail({ RESEND_API_KEY: 'k', NOTIFY_EMAIL: 'other@example.com' }, mail, f);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('own email');
  });
});
