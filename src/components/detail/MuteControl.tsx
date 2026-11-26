import { useState } from 'react';
import { fetchWithTimeout } from '../../lib/cache';
import { clock } from '../../lib/format';

/** 維護時段：部署或改版時暫停這個平台的通知。期間照樣檢查、照樣記錄。 */
export function MuteControl({ id, mutedUntil, onChanged }: { id: string; mutedUntil: number | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = async (minutes: number) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(`/api/projects/${id}/mute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ minutes }),
      });
      if (res.status === 401) return location.reload();
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mute" role="group" aria-label="維護時段">
      {mutedUntil ? (
        <>
          <span className="mute-state">維護中，通知暫停到 <span className="num">{clock(mutedUntil)}</span></span>
          <button type="button" className="text-btn" onClick={() => set(0)} disabled={busy}>
            提早恢復通知
          </button>
        </>
      ) : (
        <>
          <span className="mute-label">要部署或改版？</span>
          <button type="button" className="text-btn" onClick={() => set(60)} disabled={busy}>
            暫停通知 1 小時
          </button>
          <button type="button" className="text-btn" onClick={() => set(180)} disabled={busy}>
            3 小時
          </button>
        </>
      )}
      {error && <span className="mute-error" role="alert">{error}</span>}
    </div>
  );
}
