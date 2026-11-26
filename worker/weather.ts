// 台北天氣：Open-Meteo，免費、不用金鑰。結果快取 30 分鐘。

import type { Weather } from '../shared/types';

type Fetch = typeof fetch;

const URL_TAIPEI =
  'https://api.open-meteo.com/v1/forecast?latitude=25.0330&longitude=121.5654' +
  '&current=temperature_2m,weather_code' +
  '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code' +
  '&timezone=Asia%2FTaipei&forecast_days=1';

/** WMO 天氣代碼 → 中文 */
export function weatherLabel(code: number): string {
  if (code === 0) return '晴';
  if (code <= 2) return '晴時多雲';
  if (code === 3) return '陰';
  if (code === 45 || code === 48) return '有霧';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '下雨';
  if (code >= 71 && code <= 77) return '下雪';
  if (code >= 80 && code <= 82) return '陣雨';
  if (code >= 95) return '雷雨';
  return '多雲';
}

let cache: { at: number; data: Weather } | null = null;
const TTL_MS = 30 * 60_000;

export async function fetchWeather(f: Fetch = fetch, now = Date.now()): Promise<Weather> {
  if (cache && now - cache.at < TTL_MS) return cache.data;
  const res = await f(URL_TAIPEI, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`天氣服務回應 HTTP ${res.status}`);
  const j = (await res.json()) as {
    current?: { temperature_2m: number; weather_code: number };
    daily?: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; weather_code: number[] };
  };
  if (!j.current || !j.daily) throw new Error('天氣資料格式不對');
  const data: Weather = {
    place: '台北',
    now: Math.round(j.current.temperature_2m),
    high: Math.round(j.daily.temperature_2m_max[0]),
    low: Math.round(j.daily.temperature_2m_min[0]),
    rain: j.daily.precipitation_probability_max[0] ?? null,
    label: weatherLabel(j.daily.weather_code[0] ?? j.current.weather_code),
  };
  cache = { at: now, data };
  return data;
}
