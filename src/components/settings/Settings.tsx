import { useEffect, useState } from 'react';
import { hostLabel } from '../../lib/format';
import { call } from './api';
import { NotifyPanel } from './NotifyPanel';
import { ProjectForm } from './ProjectForm';
import { EMPTY, fromForm, toForm, type StoredProject } from './types';

export function Settings({ onChanged }: { onChanged: () => void }) {
  const [list, setList] = useState<StoredProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // 平台代號，或 'new'
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    call('/api/projects', 'GET').then(setList, (e) => setError(e.message));
  }, []);

  const apply = async (fn: () => Promise<StoredProject[]>) => {
    setError(null);
    try {
      setList(await fn());
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    if (!list) return;
    const ids = list.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    apply(() => call('/api/projects/order', 'POST', { ids }));
  };

  return (
    <main className="settings" aria-label="設定">
      <div className="settings-head">
        <div>
          <h2>平台設定</h2>
          <p className="settings-note">改完立即生效，下一次自動檢查（最多 30 分鐘）就會套用。想馬上看結果，回控制台按「立即檢查」。</p>
        </div>
        {editing !== 'new' && (
          <button type="button" className="btn" onClick={() => setEditing('new')}>
            新增平台
          </button>
        )}
      </div>

      {error && (
        <p className="banner banner-down" role="alert">
          {error}
        </p>
      )}

      {editing === 'new' && (
        <ProjectForm
          initial={EMPTY}
          isNew
          onCancel={() => setEditing(null)}
          onSave={async (f) => {
            if (await apply(() => call('/api/projects', 'POST', fromForm(f)))) setEditing(null);
          }}
        />
      )}

      {!list && !error && <p className="loading">讀取中…</p>}
      {list && (
        <ul className="settings-list">
          {list.map((p, i) => (
            <li key={p.id} className={p.paused ? 'is-paused' : undefined}>
              {editing === p.id ? (
                <ProjectForm
                  initial={toForm(p)}
                  onCancel={() => setEditing(null)}
                  onSave={async (f) => {
                    if (await apply(() => call(`/api/projects/${p.id}`, 'PUT', fromForm(f)))) setEditing(null);
                  }}
                />
              ) : (
                <div className="set-row">
                  <div className="set-order">
                    <button type="button" className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`把 ${p.name} 往上移`}>
                      ↑
                    </button>
                    <button type="button" className="icon-btn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`把 ${p.name} 往下移`}>
                      ↓
                    </button>
                  </div>
                  <div className="set-info">
                    <span className="set-name">
                      {p.name}
                      {p.paused && <span className="chip">暫停監控</span>}
                    </span>
                    <span className="set-meta">
                      {[p.summary, hostLabel(p.host), p.url ? new URL(p.url).host : '還沒設定網址', p.supabase ? 'Supabase' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <div className="set-actions">
                    {confirmDelete === p.id ? (
                      <>
                        <span className="set-confirm">刪除「{p.name}」和它的檢查紀錄？</span>
                        <button
                          type="button"
                          className="btn btn-danger btn-small"
                          onClick={async () => {
                            if (await apply(() => call(`/api/projects/${p.id}`, 'DELETE'))) setConfirmDelete(null);
                          }}
                        >
                          確定刪除
                        </button>
                        <button type="button" className="btn-quiet btn-small" onClick={() => setConfirmDelete(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn-quiet btn-small" onClick={() => setEditing(p.id)}>
                          編輯
                        </button>
                        <button
                          type="button"
                          className="btn-quiet btn-small"
                          onClick={() => apply(() => call(`/api/projects/${p.id}`, 'PUT', { ...p, paused: !p.paused }))}
                        >
                          {p.paused ? '恢復監控' : '暫停監控'}
                        </button>
                        <button type="button" className="btn-quiet btn-small" onClick={() => setConfirmDelete(p.id)}>
                          刪除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NotifyPanel />

      <p className="settings-note">
        卡片上的「N 件待辦」是看 Notion ✅ Tasks 的「平台 Platform」欄位。新增平台後，到 Notion 那一欄加一個和名稱一模一樣的選項。
      </p>
    </main>
  );
}
