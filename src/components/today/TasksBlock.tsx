import { useState } from 'react';
import type { Section, TaskItem } from '../../../shared/types';
import { Problem } from './Problem';
import { dayLabel, NOTION_TASKS, time } from './util';

const OVERDUE_PREVIEW = 5;

const BUCKET_LABEL: Record<TaskItem['bucket'], string> = { overdue: '逾期', today: '今天到期', soon: '7 天內' };

export function TasksBlock({ section, onTaskDone }: { section: Section<TaskItem[]>; onTaskDone: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState<Record<string, 'saving' | 'error'>>({});
  const [showAllOverdue, setShowAllOverdue] = useState(false);
  const head = (
    <div className="block-head">
      <h3>待辦</h3>
      <a href={NOTION_TASKS} target="_blank" rel="noreferrer">
        Notion
      </a>
    </div>
  );
  if (!section.data)
    return (
      <section className="block">
        {head}
        <Problem error={section.error ?? '讀不到待辦'} />
      </section>
    );

  const done = async (id: string) => {
    setBusy((b) => ({ ...b, [id]: 'saving' }));
    try {
      await onTaskDone(id);
    } catch {
      setBusy((b) => ({ ...b, [id]: 'error' }));
    }
  };

  const groups = (['overdue', 'today', 'soon'] as const)
    .map((b) => ({ bucket: b, items: section.data!.filter((t) => t.bucket === b) }))
    .filter((g) => g.items.length);

  return (
    <section className="block">
      {head}
      {groups.length === 0 && <p className="empty">7 天內沒有到期的待辦</p>}
      {groups.map((g) => (
        <div key={g.bucket} className={`task-group g-${g.bucket}`}>
          <p className="sub">
            {BUCKET_LABEL[g.bucket]} · {g.items.length}
          </p>
          <ul className="tasks">
            {(g.bucket === 'overdue' && !showAllOverdue ? g.items.slice(0, OVERDUE_PREVIEW) : g.items).map((t) => (
              <li key={t.id} className={busy[t.id] === 'saving' ? 'is-saving' : undefined}>
                <input
                  type="checkbox"
                  id={`task-${t.id}`}
                  aria-label={`把「${t.title}」標成完成`}
                  disabled={busy[t.id] === 'saving'}
                  checked={busy[t.id] === 'saving'}
                  onChange={() => done(t.id)}
                />
                <span className="task-body">
                  <a href={t.url} target="_blank" rel="noreferrer" className="task-title">
                    {t.title}
                  </a>
                  <span className="task-meta">
                    {[
                      g.bucket === 'soon' && t.due ? dayLabel(t.due.slice(0, 10)) : null,
                      t.due && t.due.length > 10 ? time(t.due) : null,
                      t.courses[0] ?? t.platform,
                      t.type?.split(' ')[0],
                      t.priority?.startsWith('高') ? '高優先' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {busy[t.id] === 'error' && <span className="task-error">沒有存到 Notion，再勾一次試試</span>}
                </span>
              </li>
            ))}
          </ul>
          {g.bucket === 'overdue' && g.items.length > OVERDUE_PREVIEW && (
            <button type="button" className="link-btn" onClick={() => setShowAllOverdue((v) => !v)}>
              {showAllOverdue ? '只看最近 5 件' : `再顯示 ${g.items.length - OVERDUE_PREVIEW} 件更早的逾期`}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
