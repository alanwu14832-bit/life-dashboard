import type { ProjectView } from '../../../shared/types';
import { ms } from '../../lib/format';
import { Ticks } from '../platforms/Ticks';

/** 平台：一行一個，有狀況的排前面並直接寫出原因；點一下看詳細頁。 */
export function PlatformList({ projects, now, taskCounts }: { projects: ProjectView[]; now: number; taskCounts: Record<string, number> }) {
  return (
    <section className="sec" aria-labelledby="sec-plat">
      <h2 id="sec-plat" className="sec-title">平台</h2>
      <ul className="plats">
        {projects.map((p) => {
          const tasks = taskCounts[p.config.name] ?? 0;
          const state =
            p.health === 'ok' ? `正常 · ${p.config.summary}` : p.health === 'unknown' ? p.reasons[0] ?? '未設定' : p.reasons.join('、');
          return (
            <li key={p.config.id}>
              <a className={`plat h-${p.health}`} href={`#p-${p.config.id}`}>
                <span className="plat-name">
                  <span className="plat-title">{p.config.name}</span>
                  <span className="plat-state">
                    {state}
                    {tasks > 0 && ` · ${tasks} 件待辦`}
                    {p.stale && ' · 停滯 30 天以上'}
                  </span>
                </span>
                {p.config.url ? <Ticks recent={p.http.recent} now={now} compact /> : <span />}
                <span className="plat-ms num">{p.http.latest?.ok ? ms(p.http.latest.ms) : p.http.latest ? '打不開' : '—'}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
