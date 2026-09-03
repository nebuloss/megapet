# Configuration

Layered: built-in defaults → JSON file → `MEGAPET_*` environment → flags.

```sh
megapetd -config /etc/megapet/megapet.json
megapetd -dump-config          # print the effective config and exit
megapetd -listen :9000 -db /var/lib/megapet/megapet.db
```

See [`configs/megapet.example.json`](../configs/megapet.example.json) for every field.

| Key | Default | Notes |
| --- | --- | --- |
| `listen` | `:8080` | Address to bind. |
| `base_url` | *(derived)* | Used to build share links behind a proxy. |
| `trusted_proxies` | *(none)* | CIDRs allowed to set `X-Forwarded-For`. Without this the socket peer is always used. |
| `test.download_seconds` | `10` | Per-phase duration. |
| `test.grace_seconds` | `1.5` | Ramp-up discarded from the measurement. |
| `test.download_streams` | `6` | Raise for 10 GbE, lower for a tiny box. |
| `test.overhead_factor` | `1.0` | `1.06` approximates line rate the way some consumer tools do. |
| `limits.max_streams_per_ip` | `16` | Stops one client monopolising the server. |
| `store.retention_days` | `365` | Older results are pruned daily. |
| `store.anonymize_ip` | `false` | Masks the last IPv4 octet / everything below the IPv6 /48. |
| `ipinfo.enabled` | `false` | Off by default: an internal speedtest should not phone home unless asked. Private addresses are labelled locally at no cost. |
| `ui.seed_color` | `#4F6BED` | Seeds the whole Material You palette. |

Common environment overrides: `MEGAPET_LISTEN`, `MEGAPET_DB`,
`MEGAPET_TITLE`, `MEGAPET_SEED_COLOR`, `MEGAPET_TRUSTED_PROXIES`,
`MEGAPET_DOWNLOAD_STREAMS`, `MEGAPET_ANONYMIZE_IP`,
`MEGAPET_IPINFO_ENABLED`.

### Multiple servers

List other backends under `servers` and the frontend grows a picker. When more
than one is configured and none is marked `"default": true`, the client probes
them all and preselects the closest. Cross-origin tests work because every
measurement endpoint sends permissive CORS and `Timing-Allow-Origin` headers —
they are unauthenticated and carry no credentials.

```json
"servers": [
  { "id": "par", "name": "Paris",  "url": "https://speed-par.example", "default": true },
  { "id": "lyn", "name": "Lyon",   "url": "https://speed-lyn.example" }
]
```

