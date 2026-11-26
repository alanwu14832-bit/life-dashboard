import { useEffect, useState } from 'react';

/** 用網址 # 切換頁面：#settings 設定、#week 週報、#p-<代號> 平台詳細頁，其他都是控制台 */
export type Route = { name: 'dashboard' } | { name: 'settings' } | { name: 'week' } | { name: 'detail'; id: string };
function readRoute(): Route {
  const h = location.hash.slice(1);
  if (h === 'settings') return { name: 'settings' };
  if (h === 'week') return { name: 'week' };
  const m = /^p-([a-z0-9][a-z0-9-]{0,39})$/.exec(h);
  return m ? { name: 'detail', id: m[1] } : { name: 'dashboard' };
}
export function useRoute(): Route {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const on = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
