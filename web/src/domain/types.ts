export interface TestParams {
  ping_count: number;
  ping_warmup: number;
  download_seconds: number;
  upload_seconds: number;
  grace_seconds: number;
  download_streams: number;
  upload_streams: number;
  upload_chunk_bytes: number;
  overhead_factor: number;
}

export interface Peer {
  id: string;
  name: string;
  url: string;
  location?: string;
  default?: boolean;
}

export interface ClientConfig {
  title: string;
  seed_color: string;
  show_history: boolean;
  auto_start: boolean;
  store_enabled: boolean;
  /** Address that bypasses any reverse proxy, or empty if none is advertised. */
  direct_url: string;
  version: string;
  test: TestParams;
  servers: Peer[] | null;
}

export interface IpInfo {
  ip?: string;
  isp?: string;
  asn?: string;
  country?: string;
  city?: string;
  private: boolean;
}

export interface StoredResult {
  id: string;
  created_at: string;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  ping_min_ms: number;
  ping_max_ms: number;
  download_bytes: number;
  upload_bytes: number;
  client_ip?: string;
  isp?: string;
  asn?: string;
  country?: string;
  city?: string;
  platform?: string;
  server_id?: string;
  server_name?: string;
  note?: string;
  url?: string;
  card_url?: string;
}

export interface Summary {
  count: number;
  since?: string;
  avg_download_mbps: number;
  avg_upload_mbps: number;
  avg_ping_ms: number;
  max_download_mbps: number;
  max_upload_mbps: number;
  min_ping_ms: number;
}
