import type { ClientConfig, IpInfo, StoredResult, Summary } from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Strips a trailing slash so `${base}/api/...` is always well formed. */
export function normalizeBase(url: string): string {
  return url.replace(/\/+$/, '');
}

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      /* non-JSON error body; the status text will do */
    }
    throw new ApiError(detail || `request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export function fetchConfig(base = ''): Promise<ClientConfig> {
  return getJSON<ClientConfig>(`${base}/api/config`);
}

export function fetchIp(base = ''): Promise<IpInfo> {
  return getJSON<IpInfo>(`${base}/api/ip`);
}

export interface Submission {
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  ping_min_ms: number;
  ping_max_ms: number;
  download_bytes: number;
  upload_bytes: number;
  platform: string;
  server_id: string;
  server_name: string;
  note: string;
}

export function saveResult(body: Submission, base = ''): Promise<StoredResult> {
  return getJSON<StoredResult>(`${base}/api/results`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function getResult(id: string, base = ''): Promise<StoredResult> {
  return getJSON<StoredResult>(`${base}/api/results/${encodeURIComponent(id)}`);
}

export interface ListOptions {
  limit?: number;
  days?: number;
  scope?: 'all' | 'mine';
}

export async function listResults(opt: ListOptions = {}, base = ''): Promise<StoredResult[]> {
  const params = new URLSearchParams();
  if (opt.limit) params.set('limit', String(opt.limit));
  if (opt.days) params.set('days', String(opt.days));
  if (opt.scope) params.set('scope', opt.scope);
  const body = await getJSON<{ results: StoredResult[] | null }>(
    `${base}/api/results?${params.toString()}`,
  );
  return body.results ?? [];
}

export function fetchSummary(days = 30, base = ''): Promise<Summary> {
  return getJSON<Summary>(`${base}/api/summary?days=${days}`);
}
