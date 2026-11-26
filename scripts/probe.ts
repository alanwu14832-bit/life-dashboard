// 在本機對真實網站跑一次檢查（不寫資料庫），用來確認檢查邏輯。
// 用法：NODE_USE_ENV_PROXY=1 npx vite-node scripts/probe.ts
import registry from '../projects.json';
import type { Registry } from '../shared/types';
import { checkHttp, checkSupabase } from '../worker/checks';

const { projects } = registry as Registry;
for (const p of projects) {
  const http = p.url ? await checkHttp(p.url, p.okStatus) : null;
  const supa = p.supabase ? await checkSupabase(p.supabase) : null;
  console.log(p.id.padEnd(16), http ? `${http.ok ? 'OK ' : 'BAD'} ${http.status} ${http.ms}ms ${http.error ?? ''}` : '（沒有網址）', '|', supa ? `supabase ${supa.ok ? 'OK' : 'BAD'} ${supa.status}` : '');
}
