import type { Health, ProjectView } from '../../../shared/types';
import { ago } from '../../lib/format';

export const OWNER = 'alanwu14832-bit';

export const HEALTH_LABEL: Record<Health, string> = { down: '異常', warn: '注意', unknown: '未設定', ok: '正常' };

const DEPLOY_LABEL: Record<string, string> = {
  SUCCESS: '成功',
  ACTIVE: '成功',
  INACTIVE: '已被取代',
  FAILURE: '失敗',
  ERROR: '失敗',
  IN_PROGRESS: '進行中',
  QUEUED: '排隊中',
  PENDING: '等待中',
  WAITING: '等待中',
  DESTROYED: '已移除',
};

export function deployText(p: ProjectView, now: number): string {
  const d = p.repo?.deployment;
  if (d) return `${DEPLOY_LABEL[d.state ?? ''] ?? '未知'} · ${ago(d.createdAt, now)}`;
  // 沒有 GitHub 部署紀錄的（例如用 GitHub Actions 跑 wrangler deploy），看最新 commit 的檢查結果
  const c = p.repo?.checks;
  if (c === 'SUCCESS') return '檢查通過';
  if (c === 'FAILURE' || c === 'ERROR') return '檢查失敗';
  if (c === 'PENDING' || c === 'EXPECTED') return '檢查中';
  return '—';
}

export function deployTone(p: ProjectView): 'down' | 'warn' | undefined {
  const d = p.repo?.deployment?.state;
  if (d === 'FAILURE' || d === 'ERROR') return 'warn';
  if (!p.repo?.deployment && (p.repo?.checks === 'FAILURE' || p.repo?.checks === 'ERROR')) return 'warn';
  return undefined;
}
