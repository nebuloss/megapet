import type { ClientConfig, IpInfo, StoredResult, Summary } from '../domain/types';

/** An HTTP error from the server, carrying the status so callers can branch. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * What a client may label a run with when closing it.
 *
 * Note what is absent: any figure. The server measures the run itself, so
 * there is nothing here to report and nothing it would believe. These are
 * presentation only.
 */
export interface RunLabels {
  server_id: string;
  server_name: string;
  note: string;
}

/** A run the server has opened and is measuring. */
export interface OpenRun {
  id: string;
}

/** What closing a run returns: a stored result, or nothing worth storing. */
export type RunOutcome = StoredResult | { stored: false };

export interface ListOptions {
  limit?: number;
  days?: number;
  scope?: 'all' | 'mine';
}

/**
 * A facade over the server's JSON API.
 *
 * The base URL is held rather than threaded through every call, because the
 * multi-server picker means a client can be pointed at a different backend;
 * `withBase` produces one for a peer without disturbing this one.
 */
export class ApiClient {
  /** @param base Origin to prefix every path with. Empty means same-origin. */
  constructor(private readonly base: string = '') {}

  /** A client for another backend, sharing nothing mutable with this one. */
  withBase(base: string): ApiClient {
    return new ApiClient(ApiClient.normalizeBase(base));
  }

  /** Strips trailing slashes so `${base}/api/...` is always well formed. */
  static normalizeBase(url: string): string {
    return url.replace(/\/+$/, '');
  }

  config(): Promise<ClientConfig> {
    return this.get('/api/config');
  }

  ip(): Promise<IpInfo> {
    return this.get('/api/ip');
  }

  /** Opens a run. Its id goes on every measurement request that follows. */
  openRun(): Promise<OpenRun> {
    return this.request('/api/runs', { method: 'POST' });
  }

  /** Closes a run, and with it the server's measurement of the link. */
  closeRun(id: string, labels: RunLabels): Promise<RunOutcome> {
    return this.request(`/api/runs/${encodeURIComponent(id)}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(labels),
    });
  }

  result(id: string): Promise<StoredResult> {
    return this.get(`/api/results/${encodeURIComponent(id)}`);
  }

  async results(options: ListOptions = {}): Promise<StoredResult[]> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.days) params.set('days', String(options.days));
    if (options.scope) params.set('scope', options.scope);
    const body = await this.get<{ results: StoredResult[] | null }>(
      `/api/results?${params.toString()}`,
    );
    // The server omits the array rather than sending an empty one.
    return body.results ?? [];
  }

  summary(days = 30): Promise<Summary> {
    return this.get(`/api/summary?days=${days}`);
  }

  /** Absolute URL for a path on this client's backend. */
  url(path: string): string {
    return `${this.base}${path}`;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(path), { cache: 'no-store', ...init });
    if (!response.ok) throw new ApiError(await ApiClient.describe(response), response.status);
    return (await response.json()) as T;
  }

  /** Prefers the server's own error message over the bare status text. */
  private static async describe(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      /* not JSON; fall through to the status */
    }
    return response.statusText || `request failed (${response.status})`;
  }
}
