import type { ProjectView } from '../../../shared/types';

const SLOTS = 48;
const SLOT_MS = 30 * 60_000;

/** 最近 24 小時、每 30 分鐘一格。沒有紀錄的格子留空，不假裝是正常。 */
export function Ticks({ recent, now, compact = false }: { recent: ProjectView['http']['recent']; now: number; compact?: boolean }) {
  const slots: ('ok' | 'down' | 'none')[] = Array(SLOTS).fill('none');
  for (const r of recent) {
    const idx = SLOTS - 1 - Math.floor((now - r.ts) / SLOT_MS);
    if (idx < 0 || idx >= SLOTS) continue;
    if (slots[idx] !== 'down') slots[idx] = r.ok ? 'ok' : 'down';
  }
  const downs = slots.filter((s) => s === 'down').length;
  return (
    <div className={compact ? 'ticks-wrap is-compact' : 'ticks-wrap'}>
      <div className="ticks" role="img" aria-label={`最近 24 小時：${downs ? `${downs} 次打不開` : '沒有打不開的紀錄'}`}>
        {slots.map((s, i) => (
          <span key={i} className={`tick tick-${s}`} />
        ))}
      </div>
      {!compact && (
        <div className="ticks-axis">
          <span>24 小時前</span>
          <span>現在</span>
        </div>
      )}
    </div>
  );
}
