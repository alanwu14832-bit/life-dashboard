// 前端與 Worker 共用的資料形狀。

export type Host = 'vercel' | 'cloudflare' | 'github-pages';

export interface ProjectConfig {
  id: string;
  name: string;
  summary: string;
  repo: string;
  url: string | null;
  host: Host;
  /** Supabase 專案代號（xxxx.supabase.co 的 xxxx） */
  supabase?: string;
  /** 自訂網域，有的話每天查一次到期日 */
  domain?: string;
  /** 除了 2xx/3xx 之外也算正常的狀態碼，例如整站密碼保護會回 401 */
  okStatus?: number[];
  /** 相關的 Notion 筆記 */
  notes?: string;
}

export interface Registry {
  owner: string;
  projects: ProjectConfig[];
}

export type CheckKind = 'http' | 'supabase';

export interface CheckResult {
  ok: boolean;
  status: number | null;
  ms: number | null;
  error: string | null;
}

export interface CheckRow extends CheckResult {
  project: string;
  kind: CheckKind;
  ts: number;
}

export type RollupState = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null;
export type DeployState =
  | 'SUCCESS' | 'FAILURE' | 'ERROR' | 'INACTIVE' | 'IN_PROGRESS' | 'QUEUED' | 'PENDING' | 'WAITING' | 'ACTIVE' | 'DESTROYED' | null;

export interface RepoInfo {
  private: boolean;
  pushedAt: string | null;
  branch: string | null;
  commit: { date: string; message: string; url: string } | null;
  checks: RollupState;
  openPRs: number;
  deployment: { environment: string; createdAt: string; state: DeployState } | null;
}

export interface GithubSnapshot {
  ts: number;
  error: string | null;
  repos: Record<string, RepoInfo | null>;
}

export interface DomainInfo {
  domain: string;
  expires: string | null;
  error: string | null;
}

export type Health = 'down' | 'warn' | 'unknown' | 'ok';

export interface ProjectView {
  config: ProjectConfig;
  health: Health;
  /** 給人看的異常原因，依嚴重程度排 */
  reasons: string[];
  stale: boolean;
  http: {
    latest: CheckRow | null;
    uptime24h: number | null;
    uptime7d: number | null;
    /** 最近 24 小時的每一次檢查，舊到新 */
    recent: { ts: number; ok: boolean; ms: number | null }[];
  };
  supabase: CheckRow | null;
  repo: RepoInfo | null;
  domain: DomainInfo | null;
}

export interface Overview {
  generatedAt: number;
  lastRun: { ts: number; ms: number } | null;
  github: { ts: number; error: string | null } | null;
  projects: ProjectView[];
}
