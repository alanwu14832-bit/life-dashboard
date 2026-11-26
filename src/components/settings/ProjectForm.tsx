import { useState } from 'react';
import type { Host } from '../../../shared/types';
import type { FormState } from './types';

export function ProjectForm({
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
        <Field id={fid('admin')} label="主機後台網址" hint="Vercel 或 Cloudflare 上這個專案的頁面，詳細頁會放一個按鈕">
          <input id={fid('admin')} type="url" value={f.adminUrl} onChange={(e) => set('adminUrl', e.target.value)} placeholder="https://vercel.com/…" />
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
