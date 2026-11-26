import type { ProjectConfig } from '../../../shared/types';
import { OWNER } from '../platforms/labels';

/** 主機後台的預設入口（沒有在設定頁填專案網址時用） */
function defaultAdmin(c: ProjectConfig): string {
  if (c.host === 'vercel') return 'https://vercel.com/dashboard';
  if (c.host === 'cloudflare') return 'https://dash.cloudflare.com/';
  return `https://github.com/${OWNER}/${c.repo}/settings/pages`;
}

const HOST_NAME = { vercel: 'Vercel', cloudflare: 'Cloudflare', 'github-pages': 'GitHub Pages' } as const;

/** 出狀況時一鍵進後台：網站、GitHub、Actions、主機後台、Supabase、Notion 筆記。 */
export function QuickLinks({ c }: { c: ProjectConfig }) {
  const links: { label: string; href: string; hint?: string }[] = [
    ...(c.url ? [{ label: '開啟網站', href: c.url }] : []),
    { label: 'GitHub', href: `https://github.com/${OWNER}/${c.repo}` },
    { label: 'Actions', href: `https://github.com/${OWNER}/${c.repo}/actions` },
    { label: `${HOST_NAME[c.host]} 後台`, href: c.adminUrl ?? defaultAdmin(c), hint: c.adminUrl ? undefined : '還沒填專案網址，先開首頁' },
    ...(c.supabase ? [{ label: 'Supabase', href: `https://supabase.com/dashboard/project/${c.supabase}` }] : []),
    ...(c.notes ? [{ label: 'Notion 筆記', href: c.notes }] : []),
  ];
  return (
    <nav className="qlinks" aria-label={`${c.name} 的後台入口`}>
      {links.map((l) => (
        <a key={l.label} className="qlink" href={l.href} target="_blank" rel="noreferrer" title={l.hint}>
          {l.label}
          <span aria-hidden="true">↗</span>
        </a>
      ))}
    </nav>
  );
}
