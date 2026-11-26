import { useState } from 'react';
import { addDays } from './time';

/** 快速新增待辦：打一行字、選日期，直接存進 Notion ✅ Tasks。 */
export function QuickAdd({ today, onAdd }: { today: string; onAdd: (title: string, due: string | null) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<'today' | 'tomorrow' | 'none'>('today');
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'done' | 'error'; msg?: string }>({ kind: 'idle' });

  return (
    <form
      className="qa"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setState({ kind: 'saving' });
        try {
          await onAdd(title.trim(), due === 'today' ? today : due === 'tomorrow' ? addDays(today, 1) : null);
          setTitle('');
          setState({ kind: 'done', msg: '已存進 Notion' });
        } catch (err) {
          setState({ kind: 'error', msg: err instanceof Error ? err.message : String(err) });
        }
      }}
    >
      <label htmlFor="qa-title" className="sr-only">
        新增待辦
      </label>
      <input
        id="qa-title"
        className="qa-input"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (state.kind !== 'saving') setState({ kind: 'idle' });
        }}
        placeholder="新增待辦，按 Enter 存進 Notion"
        maxLength={200}
        autoComplete="off"
      />
      <label htmlFor="qa-due" className="sr-only">
        截止日
      </label>
      <select id="qa-due" className="qa-due" value={due} onChange={(e) => setDue(e.target.value as typeof due)}>
        <option value="today">今天</option>
        <option value="tomorrow">明天</option>
        <option value="none">不設日期</option>
      </select>
      <button type="submit" className="text-btn" disabled={state.kind === 'saving' || !title.trim()}>
        {state.kind === 'saving' ? '存入中…' : '新增'}
      </button>
      {state.msg && (
        <span className={`qa-msg ${state.kind === 'error' ? 'is-error' : ''}`} role={state.kind === 'error' ? 'alert' : 'status'}>
          {state.msg}
        </span>
      )}
    </form>
  );
}
