import type { CheckResult, DomainInfo, GithubSnapshot, ProjectConfig, RepoInfo } from '../shared/types';

type Fetch = typeof fetch;

const UA = 'life-dashboard-monitor (+https://github.com)';
const TIMEOUT_MS = 15_000;

function describe(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return `超過 ${TIMEOUT_MS / 1000} 秒沒有回應`;
    return err.message || err.name;
  }
  return String(err);
}

/** 打一次網站首頁：2xx、3xx 或設定裡允許的狀態碼算正常。 */
export async function checkHttp(url: string, okStatus: number[] = [], f: Fetch = fetch): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await f(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': UA, 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    await res.body?.cancel();
    const ok = res.status < 400 || okStatus.includes(res.status);
    return { ok, status: res.status, ms, error: ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: describe(err) };
  }
}

/**
 * Supabase 沒帶金鑰打 REST 端點，活著的專案會回 401「No API key found」。
 * 被暫停或故障的專案回不了這句話，所以只認這個回應（或 200）為正常。
 */
export async function checkSupabase(ref: string, f: Fetch = fetch): Promise<CheckResult> {
  const start = Date.now();
  try {
    const res = await f(`https://${ref}.supabase.co/rest/v1/`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    const body = await res.text();
    const ok = res.status === 200 || (res.status === 401 && /api key/i.test(body));
    return { ok, status: res.status, ms, error: ok ? null : `HTTP ${res.status}，可能被暫停` };
  } catch (err) {
    return { ok: false, status: null, ms: null, error: `${describe(err)}，可能被暫停` };
  }
}

const REPO_FRAGMENT = `
fragment F on Repository {
  isPrivate
  pushedAt
  defaultBranchRef {
    name
    target { ... on Commit { committedDate messageHeadline url statusCheckRollup { state } } }
  }
  pullRequests(states: OPEN) { totalCount }
  deployments(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) {
    nodes { environment createdAt latestStatus { state } }
  }
}`;

export function buildGithubQuery(owner: string, projects: ProjectConfig[]): string {
  const parts = projects.map(
    (p, i) => `  r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(p.repo)}) { ...F }`,
  );
  return `query {\n${parts.join('\n')}\n}\n${REPO_FRAGMENT}`;
}

// GraphQL 回傳的單一 repo 形狀（只列用到的欄位）
interface GqlRepo {
  isPrivate: boolean;
  pushedAt: string | null;
  defaultBranchRef: {
    name: string;
    target: {
      committedDate?: string;
      messageHeadline?: string;
      url?: string;
      statusCheckRollup?: { state: RepoInfo['checks'] } | null;
    } | null;
  } | null;
  pullRequests: { totalCount: number };
  deployments: { nodes: { environment: string; createdAt: string; latestStatus: { state: NonNullable<RepoInfo['deployment']>['state'] } | null }[] };
}

export function mapRepo(r: GqlRepo | null | undefined): RepoInfo | null {
  if (!r) return null;
  const t = r.defaultBranchRef?.target;
  const d = r.deployments?.nodes?.[0];
  return {
    private: r.isPrivate,
    pushedAt: r.pushedAt,
    branch: r.defaultBranchRef?.name ?? null,
    commit: t?.committedDate
      ? { date: t.committedDate, message: t.messageHeadline ?? '', url: t.url ?? '' }
      : null,
    checks: t?.statusCheckRollup?.state ?? null,
    openPRs: r.pullRequests?.totalCount ?? 0,
    deployment: d ? { environment: d.environment, createdAt: d.createdAt, state: d.latestStatus?.state ?? null } : null,
  };
}

/** 一次 GraphQL 查詢拿到所有 repo 的最後 commit、檢查結果、開著的 PR 與最近部署。 */
export async function fetchGithub(
  owner: string,
  projects: ProjectConfig[],
  token: string | undefined,
  f: Fetch = fetch,
): Promise<GithubSnapshot> {
  const ts = Date.now();
  const empty = Object.fromEntries(projects.map((p) => [p.id, null]));
  if (!token) return { ts, error: '還沒設定 GITHUB_TOKEN', repos: empty };
  try {
    const res = await f('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': UA,
      },
      body: JSON.stringify({ query: buildGithubQuery(owner, projects) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ts, error: `GitHub 回應 HTTP ${res.status}`, repos: empty };
    const json = (await res.json()) as { data?: Record<string, GqlRepo | null>; errors?: { message: string }[] };
    const repos: GithubSnapshot['repos'] = {};
    projects.forEach((p, i) => {
      repos[p.id] = mapRepo(json.data?.[`r${i}`]);
    });
    // 部分 repo 讀不到（權杖沒涵蓋）時 GraphQL 仍回 200，錯誤放在 errors
    const error = json.errors?.length ? json.errors.map((e) => e.message).join('；') : null;
    return { ts, error, repos };
  } catch (err) {
    return { ts, error: describe(err), repos: empty };
  }
}

/** 用 RDAP 查網域到期日。 */
export async function fetchDomain(domain: string, f: Fetch = fetch): Promise<DomainInfo> {
  try {
    const res = await f(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      headers: { accept: 'application/rdap+json', 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { domain, expires: null, error: `RDAP 回應 HTTP ${res.status}` };
    const json = (await res.json()) as { events?: { eventAction: string; eventDate: string }[] };
    const exp = json.events?.find((e) => e.eventAction === 'expiration')?.eventDate ?? null;
    return { domain, expires: exp, error: exp ? null : '查不到到期日' };
  } catch (err) {
    return { domain, expires: null, error: describe(err) };
  }
}
