import { describe, expect, it } from 'vitest';
import { buildGithubQuery, checkHttp, checkSupabase, fetchDomain, fetchGithub, mapRepo } from '../worker/checks';
import { deriveHealth, sortByHealth, type HealthInput } from '../worker/health';
import type { CheckRow, ProjectConfig } from '../shared/types';

const fakeFetch = (status: number, body = '', delay = 0): typeof fetch =>
  (async () => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return new Response(body, { status });
  }) as unknown as typeof fetch;

const failingFetch: typeof fetch = (async () => {
  throw new TypeError('fetch failed');
}) as unknown as typeof fetch;

describe('checkHttp', () => {
  it('2xx 算正常', async () => {
    const r = await checkHttp('https://x.test', [], fakeFetch(200, 'hi'));
    expect(r).toMatchObject({ ok: true, status: 200, error: null });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
  it('5xx 算異常', async () => {
    expect(await checkHttp('https://x.test', [], fakeFetch(502))).toMatchObject({ ok: false, status: 502, error: 'HTTP 502' });
  });
  it('設定允許的狀態碼算正常（整站密碼保護回 401）', async () => {
    expect((await checkHttp('https://x.test', [401], fakeFetch(401))).ok).toBe(true);
  });
  it('連不上時記下原因', async () => {
    expect(await checkHttp('https://x.test', [], failingFetch)).toMatchObject({ ok: false, status: null, error: 'fetch failed' });
  });
});

describe('checkSupabase', () => {
  it('沒帶金鑰回 401 No API key 代表專案活著', async () => {
    const body = '{"message":"No API key found in request"}';
    expect((await checkSupabase('abc', fakeFetch(401, body))).ok).toBe(true);
  });
  it('其他回應都當作可能被暫停', async () => {
    const r = await checkSupabase('abc', fakeFetch(540, 'Project paused'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('可能被暫停');
  });
  it('連不上也當作可能被暫停', async () => {
    expect((await checkSupabase('abc', failingFetch)).ok).toBe(false);
  });
});

const proj = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: 'p',
  name: 'P',
  summary: '',
  repo: 'p-repo',
  url: 'https://p.test/',
  host: 'vercel',
  ...over,
});

describe('GitHub', () => {
  it('查詢字串為每個 repo 建一個別名', () => {
    const q = buildGithubQuery('me', [proj({ repo: 'a' }), proj({ repo: 'b"c' })]);
    expect(q).toContain('r0: repository(owner: "me", name: "a")');
    expect(q).toContain('r1: repository(owner: "me", name: "b\\"c")');
  });

  it('沒有權杖時不呼叫 API', async () => {
    const snap = await fetchGithub('me', [proj()], undefined, failingFetch);
    expect(snap.error).toContain('GITHUB_TOKEN');
    expect(snap.repos).toEqual({ p: null });
  });

  it('把 GraphQL 回應轉成卡片要的欄位，讀不到的 repo 給 null', async () => {
    const data = {
      data: {
        r0: {
          isPrivate: false,
          pushedAt: '2026-11-26T03:53:37Z',
          defaultBranchRef: {
            name: 'main',
            target: {
              committedDate: '2026-11-26T03:53:00Z',
              messageHeadline: 'Merge pull request #41',
              url: 'https://github.com/me/a/commit/1',
              statusCheckRollup: { state: 'SUCCESS' },
            },
          },
          pullRequests: { totalCount: 2 },
          deployments: { nodes: [{ environment: 'Production', createdAt: '2026-11-26T03:54:00Z', latestStatus: { state: 'SUCCESS' } }] },
        },
        r1: null,
      },
      errors: [{ message: "Could not resolve to a Repository with the name 'me/b'." }],
    };
    const snap = await fetchGithub('me', [proj({ id: 'a' }), proj({ id: 'b' })], 't', fakeFetch(200, JSON.stringify(data)));
    expect(snap.repos.a).toEqual({
      private: false,
      pushedAt: '2026-11-26T03:53:37Z',
      branch: 'main',
      commit: { date: '2026-11-26T03:53:00Z', message: 'Merge pull request #41', url: 'https://github.com/me/a/commit/1' },
      checks: 'SUCCESS',
      openPRs: 2,
      deployment: { environment: 'Production', createdAt: '2026-11-26T03:54:00Z', state: 'SUCCESS' },
    });
    expect(snap.repos.b).toBeNull();
    expect(snap.error).toContain('Could not resolve');
  });

  it('空 repo（沒有預設分支）不會壞掉', () => {
    expect(
      mapRepo({ isPrivate: true, pushedAt: null, defaultBranchRef: null, pullRequests: { totalCount: 0 }, deployments: { nodes: [] } }),
    ).toMatchObject({ commit: null, checks: null, deployment: null, branch: null });
  });
});

describe('fetchDomain', () => {
  it('讀出 expiration 事件', async () => {
    const body = JSON.stringify({ events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, { eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }] });
    expect(await fetchDomain('x.tw', fakeFetch(200, body))).toEqual({ domain: 'x.tw', expires: '2027-01-01T00:00:00Z', error: null });
  });
});

const NOW = Date.parse('2026-11-26T12:00:00Z');
const row = (over: Partial<CheckRow> = {}): CheckRow => ({
  project: 'p', kind: 'http', ts: NOW - 60_000, ok: true, status: 200, ms: 300, error: null, ...over,
});
const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  config: proj(),
  now: NOW,
  latestHttp: row(),
  uptime24h: 1,
  uptime7d: 1,
  recent: [],
  supabase: null,
  repo: null,
  domain: null,
  ...over,
});

describe('deriveHealth', () => {
  it('全部正常', () => {
    expect(deriveHealth(input())).toMatchObject({ health: 'ok', reasons: [] });
  });
  it('網站打不開是異常', () => {
    const v = deriveHealth(input({ latestHttp: row({ ok: false, status: 503, error: 'HTTP 503' }) }));
    expect(v.health).toBe('down');
    expect(v.reasons[0]).toContain('HTTP 503');
  });
  it('Supabase 沒回應是異常，即使網站還開得起來', () => {
    expect(deriveHealth(input({ supabase: row({ kind: 'supabase', ok: false }) })).health).toBe('down');
  });
  it('部署失敗與回應偏慢是注意', () => {
    const v = deriveHealth(
      input({
        latestHttp: row({ ms: 4200 }),
        repo: {
          private: false, pushedAt: null, branch: 'main', commit: null, checks: 'SUCCESS', openPRs: 0,
          deployment: { environment: 'Production', createdAt: '2026-11-26T00:00:00Z', state: 'FAILURE' },
        },
      }),
    );
    expect(v.health).toBe('warn');
    expect(v.reasons).toEqual(['最近一次部署失敗', '回應偏慢（4.2 秒）']);
  });
  it('24 小時內掛過但現在恢復，提醒一下', () => {
    expect(deriveHealth(input({ uptime24h: 0.98 })).reasons).toContain('過去 24 小時內曾經打不開');
  });
  it('沒設定網址是未設定，不是正常', () => {
    expect(deriveHealth(input({ config: proj({ url: null }), latestHttp: null }))).toMatchObject({
      health: 'unknown',
      reasons: ['還沒設定網址'],
    });
  });
  it('網域 30 天內到期要提醒', () => {
    const v = deriveHealth(input({ domain: { domain: 'x.tw', expires: '2026-12-10T00:00:00Z', error: null } }));
    expect(v.health).toBe('warn');
    expect(v.reasons[0]).toMatch(/網域 1\d 天後到期/);
  });
  it('超過 30 天沒 push 標為停滯', () => {
    const repo = { private: false, pushedAt: '2026-09-07T08:39:26Z', branch: 'main', commit: null, checks: null, openPRs: 0, deployment: null };
    expect(deriveHealth(input({ repo })).stale).toBe(true);
    expect(deriveHealth(input({ repo: { ...repo, pushedAt: '2026-11-20T00:00:00Z' } })).stale).toBe(false);
  });
  it('異常排最前面、未設定排最後，同燈號維持原本順序', () => {
    const list = [
      deriveHealth(input({ config: proj({ id: 'a' }) })),
      deriveHealth(input({ config: proj({ id: 'b', url: null }), latestHttp: null })),
      deriveHealth(input({ config: proj({ id: 'c' }), latestHttp: row({ ok: false }) })),
      deriveHealth(input({ config: proj({ id: 'd' }) })),
    ];
    expect(sortByHealth(list).map((p) => p.config.id)).toEqual(['c', 'a', 'd', 'b']);
  });
});
