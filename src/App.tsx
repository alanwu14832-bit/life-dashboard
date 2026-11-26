import { useEffect, useState } from 'react';
import { Detail } from './components/detail/Detail';
import { Header } from './components/Header';
import { Masthead } from './components/briefing/Masthead';
import { PlatformList } from './components/briefing/PlatformList';
import { SideNotes } from './components/briefing/SideNotes';
import { TodayTimeline } from './components/briefing/TodayTimeline';
import { WeekAhead } from './components/briefing/WeekAhead';
import { Settings } from './components/settings/Settings';
import { Weekly } from './components/weekly/Weekly';
import { ErrorState, PlatformsSkeleton, TodaySkeleton } from './components/States';
import { ThemeToggle } from './components/ThemeToggle';
import { useRoute } from './lib/route';
import { useDashboardData } from './lib/useDashboardData';

/** 每 30 秒更新一次「幾分鐘前」之類的相對時間 */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function App() {
  const d = useDashboardData();
  const route = useRoute();
  const now = useNow();
  const { overview, today } = d;

  const scheduleLate = overview?.lastRun ? now - overview.lastRun.ts > 75 * 60_000 : false;

  return (
    <div className="page">
      <a className="skip-link" href="#main">
        跳到主要內容
      </a>
      <Header
        overview={overview}
        now={now}
        onDashboard={route.name === 'dashboard'}
        refreshing={d.refreshing}
        running={d.running}
        onRunNow={d.runNow}
      />

      {/* 系統提醒：有舊資料時，讀取失敗只用橫幅提醒，畫面保留上一次的內容 */}
      <section className="banners" aria-label="系統提醒">
        {d.overviewError && overview && (
          <p className="banner banner-down" role="alert">
            {d.overviewError}
          </p>
        )}
        {scheduleLate && <p className="banner banner-warn">自動檢查超過一小時沒跑了，Cloudflare 的排程可能停了。</p>}
        {overview?.github?.error && <p className="banner banner-muted">GitHub 資料沒更新：{overview.github.error}</p>}
      </section>

      <div id="main" tabIndex={-1} className="main-anchor">
        {route.name === 'settings' ? (
          <Settings onChanged={d.reloadOverview} />
        ) : route.name === 'week' ? (
          <Weekly />
        ) : route.name === 'detail' ? (
          <Detail id={route.id} project={overview?.projects.find((p) => p.config.id === route.id)} now={now} onChanged={d.reloadOverview} />
        ) : (
          <main className="brief" aria-label="今天的簡報">
            <Masthead overview={overview} today={today} now={now} />
            {today ? (
              <>
                {d.todayError && <ErrorState message={`${d.todayError}（下面是上一次的資料）`} onRetry={d.reloadToday} />}
                <TodayTimeline today={today} now={now} onTaskDone={d.completeTask} onTaskAdd={d.addTask} />
                <WeekAhead today={today} onTaskDone={d.completeTask} />
              </>
            ) : d.todayError ? (
              <ErrorState message={d.todayError} onRetry={d.reloadToday} />
            ) : (
              <TodaySkeleton />
            )}
            {overview ? (
              <PlatformList projects={overview.projects} now={now} taskCounts={today?.platformTasks.data ?? {}} />
            ) : d.overviewError ? (
              <ErrorState message={d.overviewError} onRetry={d.reloadOverview} />
            ) : (
              <PlatformsSkeleton />
            )}
            {today && <SideNotes today={today} now={now} />}
          </main>
        )}
      </div>

      <footer className="foot">
        <span>每 30 分鐘自動檢查一次 · 資料保留 30 天 · 新增或修改平台請到「設定」</span>
        <ThemeToggle />
      </footer>
    </div>
  );
}
