import { useState } from 'react';
import type { TaskItem } from '../../../shared/types';

/** 待辦的勾選框：寫回 Notion 成功後由上層把它拿掉；失敗時在旁邊說明。 */
export function TaskCheck({ task, onDone }: { task: TaskItem; onDone: (id: string) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle');
  return (
    <>
      <input
        type="checkbox"
        className="chk"
        id={`task-${task.id}`}
        aria-label={`把「${task.title}」標成完成`}
        disabled={state === 'saving'}
        checked={state === 'saving'}
        onChange={async () => {
          setState('saving');
          try {
            await onDone(task.id);
          } catch {
            setState('error');
          }
        }}
      />
      {state === 'error' && <span className="sr-only" role="alert">沒有存到 Notion</span>}
      {state === 'error' && <span className="line-error">沒有存到 Notion，再勾一次試試</span>}
    </>
  );
}
