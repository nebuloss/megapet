# HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Frontend bootstrap: test parameters, servers, UI settings. |
| `GET` | `/api/ip` | Client address, and ISP/ASN when `ipinfo` is on. |
| `GET` | `/api/ping` | Empty 200 for latency probing. |
| `GET` | `/api/download?bytes=N` | Streams N incompressible bytes. |
| `POST` | `/api/upload` | Discards the body, returns the byte count. |
| `POST` | `/api/runs` | Opens a run. Returns the id to quote on every stream. |
| `POST` | `/api/runs/{id}/close` | Ends a run; the server records what it measured. |
| `GET` | `/api/results?limit=&days=&scope=mine` | History, newest first. |
| `GET` | `/api/results/{id}` | One result. |
| `GET` | `/api/results/{id}/card.svg` | Shareable SVG card. |
| `GET` | `/api/summary?days=30` | Rolling aggregates. |
| `GET` | `/healthz` | Liveness, including a store probe. |
| `GET` | `/metrics` | Prometheus text format. |

`GET /empty.php` and `GET /garbage.php?ckSize=N` are aliases for the ping and
download endpoints, so existing LibreSpeed probes and bookmarks keep working
while you migrate.

**Results are measured by the server, not reported by the client.** There is no
endpoint that accepts a figure. A client opens a run, quotes its id on every
download and upload request, and closes it; the numbers written to the history
are the ones this process counted while that happened. A client can therefore
produce a real measurement of a real link, but it cannot invent one.

A run is only reachable from the address that opened it, because its id travels
in a query string and query strings reach proxy logs, browser history and
`Referer` headers.

Latency is absent from stored results. A round trip can only be timed by the
end that sends the first byte, and that is the browser, so the server never
observes one. It is still measured and shown live; it is simply not recorded as
though the server had witnessed it.

A run that moved too little to outlast the grace period has no honest figure
and is not stored — `{"stored": false}` rather than a row of zeroes.

