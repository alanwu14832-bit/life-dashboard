import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiBriefResponse } from '../../../shared/types';
import { fetchWithTimeout, readCache, writeCache } from '../../lib/cache';

const hm = (ms: number) =>
  new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

/** 產生一次大約 5～20 秒，給寬一點的等待時間 */
const AI_TIMEOUT_MS = 90_000;
const PENDING_RETRY_MS = 15_000;

/**
 * 刊頭下方的「今天先做」：Claude 根據行程、待辦和平台狀況排出的 1～3 步。
 * 沒設定金鑰、或今天還沒有成功產生過時整塊不顯示。
 */
export function AiFocus({ date }: { date: string | undefined }) {
  const [data, setData] = useState<AiBriefResponse | null>(() => readCache<AiBriefResponse>('ai')?.data ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const save = useCallback((r: AiBriefResponse) => {
    setData(r);
    writeCache('ai', r);
    clearTimeout(timer.current);
    // 別的請求正在產生：等一下再來拿
    if (r.pending) timer.current = setTimeout(() => void load(), PENDING_RETRY_MS);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/ai', {}, AI_TIMEOUT_MS);
      if (res.ok) save((await res.json()) as AiBriefResponse);
    } catch {
      // 讀不到就維持原狀
    }
  }, [save]);

  // 打開網頁、或過了午夜換日時重新讀
  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, [load, date]);

  const regenerate = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetchWithTimeout('/api/ai/regenerate', { method: 'POST' }, AI_TIMEOUT_MS);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const r = body as AiBriefResponse;
      save(r);
      if (r.error) setMsg(`這次沒成功：${r.error}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data?.configured) return null;
  const brief = data.brief && data.brief.date === date ? data.brief : null;
  if (!brief) {
    return data.pending ? (
      <p className="ai-wait" role="status">
        AI 正在整理今天先做的事…
      </p>
    ) : null;
  }

  return (
    <section className="ai" aria-labelledby="ai-title">
      <div className="ai-head">
        <h3 id="ai-title" className="ai-title">
          今天先做
        </h3>
        <p className="ai-meta">
          AI 建議 · {hm(brief.at)} 產生
          {data.regenerationsLeft > 0 && (
            <>
              {' · '}
              <button type="button" className="text-btn is-quiet" onClick={regenerate} disabled={busy}>
                {busy ? '重新產生中…' : '重新產生'}
              </button>
            </>
          )}
        </p>
      </div>
      {brief.headline && <p className="ai-headline">{brief.headline}</p>}
      <ol className="ai-steps">
        {brief.steps.map((s, i) => (
          <li key={i}>
            <span className="ai-when">{s.when}</span>
            <span className="ai-body">
              <span className="ai-action">{s.action}</span>
              <span className="ai-why">{s.why}</span>
            </span>
          </li>
        ))}
      </ol>
      {msg && (
        <p className="ai-msg" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
