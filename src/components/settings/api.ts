import { fetchWithTimeout } from '../../lib/cache';
import type { StoredProject } from './types';

export async function call(path: string, method: string, body?: unknown): Promise<StoredProject[]> {
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
