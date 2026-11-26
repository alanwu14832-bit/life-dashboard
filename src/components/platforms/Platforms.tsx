import { useState } from 'react';
import type { ProjectView } from '../../../shared/types';
import { ProjectCard } from './ProjectCard';
import { ProjectRow } from './ProjectRow';

export function Platforms({ projects, now, taskCounts }: { projects: ProjectView[]; now: number; taskCounts: Record<string, number> }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const attention = projects.filter((p) => p.health === 'down' || p.health === 'warn');
  const rest = projects.filter((p) => p.health !== 'down' && p.health !== 'warn');
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <>
      {attention.length > 0 && (
        <section className="plat-section" aria-label="需要處理">
          <h2 className="section-title">需要處理</h2>
          <div className="projects">
            {attention.map((p) => (
              <ProjectCard key={p.config.id} p={p} now={now} openTasks={taskCounts[p.config.name] ?? 0} />
            ))}
          </div>
        </section>
      )}
      <section className="plat-section" aria-label="平台">
        <h2 className="section-title">{attention.length ? '其他平台' : '平台'}</h2>
        <ul className="rows">
          {rest.map((p) => (
            <li key={p.config.id}>
              {open[p.config.id] ? (
                <div className="row-open">
                  <ProjectCard p={p} now={now} openTasks={taskCounts[p.config.name] ?? 0} onCollapse={() => toggle(p.config.id)} />
                </div>
              ) : (
                <ProjectRow p={p} now={now} openTasks={taskCounts[p.config.name] ?? 0} onExpand={() => toggle(p.config.id)} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
