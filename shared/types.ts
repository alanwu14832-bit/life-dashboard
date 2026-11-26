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
  /** 主機後台網址（沒填時依主機給預設） */
  adminUrl?: string;
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
  /** 維護時段：通知暫停到這個時間（毫秒）；沒有暫停時是 null */
  mutedUntil: number | null;
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

// ── 第二階段：今天 ──────────────────────────────────────────

export interface TaskItem {
  id: string;
  title: string;
  url: string;
  due: string | null;
  status: string | null;
  priority: string | null;
  type: string | null;
  platform: string | null;
  courses: string[];
  /** overdue＝逾期、today＝今天到期、soon＝7 天內 */
  bucket: 'overdue' | 'today' | 'soon';
}

export interface CalendarEvent {
  title: string;
  location: string | null;
  allDay: boolean;
  /** 整天的行程是 YYYY-MM-DD（結束日不含）；有時間的是 ISO 時間 */
  start: string;
  end: string;
}

export interface ScheduleStatus {
  name: string;
  /** ok＝今天已寫入、late＝該寫了但還沒有、idle＝今天本來就不用寫或還沒到時間 */
  state: 'ok' | 'late' | 'idle';
  note: string;
  latestDate: string | null;
  latestTitle: string | null;
  url: string | null;
  /** 最新一筆的「今日焦點」 */
  headline: string | null;
  /** 一句話的數字摘要，例如「加權指數 23,456.78，+1.47%」 */
  figure: string | null;
  /** 台股方向：up 上漲、down 下跌、flat 平盤 */
  direction: 'up' | 'down' | 'flat' | null;
}

export interface Weather {
  place: string;
  now: number;
  high: number;
  low: number;
  /** 今天最高降雨機率（%） */
  rain: number | null;
  label: string;
}

export interface KnowledgeItem {
  title: string;
  topic: string | null;
  type: string | null;
  created: string;
  url: string;
}

export interface Section<T> {
  data: T | null;
  error: string | null;
}

export interface Today {
  date: string;
  tasks: Section<TaskItem[]>;
  platformTasks: Section<Record<string, number>>;
  calendar: Section<CalendarEvent[]>;
  schedules: Section<ScheduleStatus[]>;
  knowledge: Section<KnowledgeItem[]>;
  weather: Section<Weather>;
}

// ── 每週回顧 ──────────────────────────────────────────

export interface Weekly {
  /** 這一週的範圍（台北日期，含頭尾） */
  from: string;
  to: string;
  done: Section<{ title: string; url: string; date: string }[]>;
  platforms: { id: string; name: string; uptime: number | null; commits: number | null; incidents: number }[];
  notes: Section<{ title: string; url: string }[]>;
  nextWeek: Section<{ events: number; tasks: number }>;
}

// ── 單一平台詳細頁 ──────────────────────────────────────────

export interface ProjectHistory {
  /** 最近 30 天每天的可用率（台北日期），沒有紀錄的天是 null */
  days: { date: string; uptime: number | null; checks: number }[];
  /** 最近 7 天每小時的平均回應時間（毫秒） */
  latency: { ts: number; ms: number | null; down: boolean }[];
  incidents: { label: string; detail: string | null; openedAt: number; closedAt: number | null }[];
  uptime30d: number | null;
}

// ── AI 今日重點 ──────────────────────────────────────────

export interface AiBrief {
  /** 這份建議屬於哪一天（台北日期） */
  date: string;
  /** 產生時間（毫秒） */
  at: number;
  model: string;
  headline: string;
  steps: { when: string; action: string; why: string }[];
  /** 今天手動重新產生了幾次 */
  regenerations: number;
  usage: { input: number; output: number };
}

export interface AiBriefResponse {
  configured: boolean;
  brief: AiBrief | null;
  error: string | null;
  regenerationsLeft: number;
  /** 正在產生中（另一個請求或排程已經在呼叫） */
  pending: boolean;
}
