# HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Frontend bootstrap: test parameters, servers, UI settings. |
| `GET` | `/api/ip` | Client address, and ISP/ASN when `ipinfo` is on. |
| `GET` | `/api/ping` | Empty 200 for latency probing. |
| `GET` | `/api/download?bytes=N` | Streams N incompressible bytes. |
| `POST` | `/api/upload` | Discards the body, returns the byte count. |
| `POST` | `/api/results` | Saves a result, returns it with share links. |
| `GET` | `/api/results?limit=&days=&scope=mine` | History, newest first. |
| `GET` | `/api/results/{id}` | One result. |
| `GET` | `/api/results/{id}/card.svg` | Shareable SVG card. |
| `GET` | `/api/summary?days=30` | Rolling aggregates. |
| `GET` | `/healthz` | Liveness, including a store probe. |
| `GET` | `/metrics` | Prometheus text format. |

`GET /empty.php` and `GET /garbage.php?ckSize=N` are aliases for the ping and
download endpoints, so existing LibreSpeed probes and bookmarks keep working
while you migrate.

Results are written by the browser, which is the only thing that can measure the
link, so the values cannot be verified server-side. They *are* clamped: NaN,
infinities and negatives become zero, and absurd figures are capped, so a bad
client cannot poison the history.

