import { useCallback, useEffect, useState } from 'react';
import type { Overview, Today } from '../../shared/types';
import { fetchWithTimeout, readCache, writeCache } from './cache';

const POLL_MS = 5 * 60_000;

/** 登入過期時重新整理，會出現登入頁 */
function handleAuth(res: Response): boolean {
  if (res.status === 401) {
    location.reload();
    return true;
  }
  return false;
}

/**
 * 控制台的所有資料：平台監控（overview）與今天區塊（today）。
 * 先用瀏覽器暫存的上一次資料把畫面畫出來，再到背景更新；每 5 分鐘自動重抓。
 */
export function useDashboardData() {
  const [overview, setOverview] = useState<Overview | null>(() => readCache<Overview>('overview')?.data ?? null);
  const [today, setToday] = useState<Today | null>(() => readCache<Today>('today')?.data ?? null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [todayError, setTodayError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [running, setRunning] = useState(false);

  const saveOverview = (o: Overview) => {
    setOverview(o);
    writeCache('overview', o);
    setOverviewError(null);
  };

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/overview');
      if (handleAuth(res)) return;
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      saveOverview(body as Overview);
    } catch (err) {
      setOverviewError(`讀不到監控資料：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const loadToday = useCallback(async (fresh = false) => {
    try {
      const res = await fetchWithTimeout(fresh ? '/api/today?fresh=1' : '/api/today');
      if (handleAuth(res)) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Today;
      setToday(body);
      writeCache('today', body);
      setTodayError(null);
    } catch (err) {
      setTodayError(`讀不到今天的資料：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadOverview(), loadToday()]);
    setRefreshing(false);
  }, [loadOverview, loadToday]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    return () => clearInterval(poll);
  }, [refresh]);

  /** 立即跑一輪檢查 */
  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetchWithTimeout('/api/run', { method: 'POST' }, 60_000);
      if (handleAuth(res)) return;
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      saveOverview(body as Overview);
    } catch (err) {
      setOverviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }, []);

  /** 勾選完成：寫回 Notion 成功後才從清單拿掉，失敗時丟出錯誤讓清單顯示 */
  const completeTask = useCallback(async (id: string) => {
    const res = await fetchWithTimeout(`/api/tasks/${id}/complete`, { method: 'POST' });
    if (handleAuth(res)) return;
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    setToday((t) => {
      if (!t?.tasks.data) return t;
      const task = t.tasks.data.find((x) => x.id === id);
      const counts = { ...(t.platformTasks.data ?? {}) };
      if (task?.platform && counts[task.platform]) counts[task.platform] -= 1;
      const next: Today = {
        ...t,
        tasks: { ...t.tasks, data: t.tasks.data.filter((x) => x.id !== id) },
        platformTasks: t.platformTasks.data ? { ...t.platformTasks, data: counts } : t.platformTasks,
      };
      writeCache('today', next);
      return next;
    });
  }, []);

  return {
    overview,
    today,
    overviewError,
    todayError,
    refreshing,
    running,
    reloadOverview: loadOverview,
    reloadToday: () => loadToday(true),
    runNow,
    completeTask,
  };
}
