import type { Today } from '../../../shared/types';
import { ago } from '../../lib/format';
import { Problem } from './Problem';

export function KnowledgeBlock({ today, now }: { today: Today; now: number }) {
  const { knowledge } = today;
  return (
    <section className="block">
      <div className="block-head">
        <h3>知識庫 · 最近 7 天</h3>
      </div>
      {!knowledge.data ? (
        <Problem error={knowledge.error ?? '讀不到知識庫'} />
      ) : knowledge.data.length === 0 ? (
        <p className="empty">這 7 天沒有新筆記</p>
      ) : (
        <ul className="notes">
          {knowledge.data.map((k) => (
            <li key={k.url}>
              <a href={k.url} target="_blank" rel="noreferrer">
                {k.title}
              </a>
              <span className="note-meta">
                {[k.topic, ago(k.created, now)].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
