// 瀏覽器端暫存上一次的資料：打開網站馬上有畫面，背景再更新。
// 只存在這台裝置，登出時清掉。讀寫失敗（私密瀏覽、空間滿）就當作沒有暫存。

const PREFIX = 'ld:';
const MAX_AGE_MS = 24 * 3_600_000;

export function readCache<T>(key: string): { data: T; at: number } | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { data: T; at: number };
    return Date.now() - v.at < MAX_AGE_MS ? v : null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, at: Date.now() }));
  } catch {
    // 存不進去也沒關係
  }
}

export function clearCache(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {
    // 忽略
  }
}

/** 加上逾時的 fetch：手機網路卡住時 20 秒後放棄，畫面保留上一次的資料。 */
export function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 20_000): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(ms) });
}
