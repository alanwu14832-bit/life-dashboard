import { useEffect, useState } from 'react';
import { fetchWithTimeout } from '../../lib/cache';

interface NotifyStatus {
  configured: boolean;
  last: { ts: number; subject: string; ok: boolean; error: string | null } | null;
  open: { label: string; detail: string; opened_at: number }[];
}

/** 通知設定狀態、最後一封信、寄測試信。 */
export function NotifyPanel() {
  const [st, setSt] = useState<NotifyStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetchWithTimeout('/api/notify')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSt(d as NotifyStatus))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const test = async () => {
    setTesting(true);
    setMsg(null);
    try {
      const res = await fetchWithTimeout('/api/notify/test', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      setMsg(res.ok ? '已寄出，去信箱看看（可能在垃圾郵件）' : `沒有寄出：${body.error ?? `HTTP ${res.status}`}`);
    } finally {
      setTesting(false);
      load();
    }
  };

  const when = (t: number) =>
    new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t));

  return (
    <section className="notify" aria-label="異常通知">
      <h3>異常通知（Email）</h3>
      {!st ? (
        <p className="empty">讀取中…</p>
      ) : (
        <>
          <div className="notify-row">
            {st.configured ? <span className="ok">已設定</span> : <span className="bad">還沒設定</span>}
            <span className="settings-note" style={{ margin: 0 }}>
              網站或 Supabase 連續兩次檢查失敗、網域 30 天內到期、平日傍晚排程還沒寫入時寄信；恢復時也會通知。
            </span>
          </div>
          {!st.configured && (
            <p className="settings-note">到 Cloudflare 的 Variables and Secrets 新增兩個 Secret：RESEND_API_KEY 與 NOTIFY_EMAIL（你註冊 Resend 用的信箱）。</p>
          )}
          {st.last && (
            <p className="settings-note">
              最後一封：{when(st.last.ts)}「{st.last.subject}」{st.last.ok ? '已寄出' : `沒有寄出（${st.last.error}）`}
            </p>
          )}
          {st.open.length > 0 && (
            <ul className="notify-open">
              {st.open.map((o) => (
                <li key={`${o.label}-${o.opened_at}`}>
                  進行中：{o.label}，{when(o.opened_at)} 起
                </li>
              ))}
            </ul>
          )}
          <div className="notify-row">
            <button type="button" className="btn-quiet btn-small" onClick={test} disabled={testing || !st.configured}>
              {testing ? '寄送中…' : '寄一封測試信'}
            </button>
            {msg && <span className="settings-note" style={{ margin: 0 }}>{msg}</span>}
          </div>
        </>
      )}
    </section>
  );
}
