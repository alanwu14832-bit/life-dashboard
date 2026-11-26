import type { Host } from '../../../shared/types';

export interface StoredProject {
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

export interface FormState {
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

export const EMPTY: FormState = {
  id: '', name: '', summary: '', repo: '', url: '', host: 'vercel', supabase: '', domain: '', okStatus: '', notes: '', paused: false,
};

export const toForm = (p: StoredProject): FormState => ({
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

export const fromForm = (f: FormState) => ({
  ...f,
  okStatus: f.okStatus
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number),
});
