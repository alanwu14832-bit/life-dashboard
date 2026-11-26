import { useEffect, useState } from 'react';
import type { Host } from '../shared/types';
import { fetchWithTimeout } from './cache';
import { hostLabel } from './format';

interface StoredProject {
  id: string;
  name: string;
  summary: string;
  repo: string;
  url: string | null;
  host: Host;
  supabase?: string;
  domain?: string;
  okStatus?: number[];
  notes?: string;
  paused: boolean;
}

interface FormState {
  id: string;
  name: string;
  summary: string;
  repo: string;
  url: string;
  host: Host;
  supabase: string;
  domain: string;
  okStatus: string;
  notes: string;
  paused: boolean;
}

const EMPTY: FormState = {
  id: '', name: '', summary: '', repo: '', url: '', host: 'vercel', supabase: '', domain: '', okStatus: '', notes: '', paused: false,
};

const toForm = (p: StoredProject): FormState => ({
  id: p.id,
  name: p.name,
  summary: p.summary,
  repo: p.repo,
  url: p.url ?? '',
  host: p.host,
  supabase: p.supabase ?? '',
  domain: p.domain ?? '',
  okStatus: (p.okStatus ?? []).join(', '),
  notes: p.notes ?? '',
  paused: p.paused,
});

const fromForm = (f: FormState) => ({
  ...f,
  okStatus: f.okStatus
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number),
});

async function call(path: string, method: string, body?: unknown): Promise<StoredProject[]> {
  const res = await fetchWithTimeout(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    location.reload();
    return [];
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.projects as StoredProject[];
}

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

      <p className="settings-note">
        卡片上的「N 件待辦」是看 Notion ✅ Tasks 的「平台 Platform」欄位。新增平台後，到 Notion 那一欄加一個和名稱一模一樣的選項。
      </p>
    </main>
  );
}

function ProjectForm({
  initial,
  isNew = false,
  onSave,
  onCancel,
}: {
  initial: FormState;
  isNew?: boolean;
  onSave: (f: FormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [f, setF] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const fid = (k: string) => `pf-${initial.id || 'new'}-${k}`;

  return (
    <form
      className="pform"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        await onSave(f);
        setSaving(false);
      }}
    >
      <h3>{isNew ? '新增平台' : `編輯 ${initial.name}`}</h3>
      <div className="pform-grid">
        <Field id={fid('name')} label="名稱" hint="卡片上顯示的名字，也是 Notion「平台」欄的選項名稱">
          <input id={fid('name')} value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={60} />
        </Field>
        <Field id={fid('summary')} label="一句話說明">
          <input id={fid('summary')} value={f.summary} onChange={(e) => set('summary', e.target.value)} maxLength={60} />
        </Field>
        <Field id={fid('id')} label="代號" hint={isNew ? '小寫英文、數字和 -，建立後不能改' : '建立後不能改'}>
          <input
            id={fid('id')}
            value={f.id}
            onChange={(e) => set('id', e.target.value.toLowerCase())}
            required
            disabled={!isNew}
            pattern="[a-z0-9][a-z0-9\-]*"
            maxLength={40}
          />
        </Field>
        <Field id={fid('repo')} label="GitHub repo" hint="只填名稱，例如 bafinstat">
          <input id={fid('repo')} value={f.repo} onChange={(e) => set('repo', e.target.value)} required maxLength={100} />
        </Field>
        <Field id={fid('url')} label="網址" hint="留空就只看 GitHub，不檢查網站">
          <input id={fid('url')} type="url" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://" />
        </Field>
        <Field id={fid('host')} label="主機">
          <select id={fid('host')} value={f.host} onChange={(e) => set('host', e.target.value as Host)}>
            <option value="vercel">Vercel</option>
            <option value="cloudflare">Cloudflare</option>
            <option value="github-pages">GitHub Pages</option>
          </select>
        </Field>
        <Field id={fid('supabase')} label="Supabase 代號" hint="https://xxxx.supabase.co 裡的 xxxx，沒有就留空">
          <input id={fid('supabase')} value={f.supabase} onChange={(e) => set('supabase', e.target.value.trim())} maxLength={40} />
        </Field>
        <Field id={fid('domain')} label="自訂網域" hint="例如 ntubafin.tw，每天查一次到期日">
          <input id={fid('domain')} value={f.domain} onChange={(e) => set('domain', e.target.value.trim())} maxLength={253} />
        </Field>
        <Field id={fid('ok')} label="也算正常的狀態碼" hint="例如整站密碼保護回 401，就填 401">
          <input id={fid('ok')} value={f.okStatus} onChange={(e) => set('okStatus', e.target.value)} placeholder="401" />
        </Field>
        <Field id={fid('notes')} label="Notion 筆記連結">
          <input id={fid('notes')} type="url" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="https://app.notion.com/p/…" />
        </Field>
      </div>
      <label className="pform-check" htmlFor={fid('paused')}>
        <input id={fid('paused')} type="checkbox" checked={f.paused} onChange={(e) => set('paused', e.target.checked)} />
        暫停監控（保留設定，但不檢查、不顯示在控制台）
      </label>
      <div className="pform-actions">
        <button type="submit" className="btn" disabled={saving}>
          {saving ? '儲存中…' : isNew ? '新增' : '儲存'}
        </button>
        <button type="button" className="btn-quiet" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}
