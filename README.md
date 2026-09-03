# Speedtest

A self-hosted network speedtest: a Go server and a TypeScript frontend that ship
as **one static binary** with no runtime dependencies. Built as a lighter,
modern replacement for LibreSpeed, with a Material You interface and a SQLite
result history.

```
┌──────────────────────────────────────────────────────────────┐
│  speedtestd  (single binary, ~11 MB, CGO-free)               │
│                                                              │
│  /api/ping       empty 200s for latency and jitter           │
│  /api/download   incompressible random bytes, N streams      │
│  /api/upload     byte sink, N streams                        │
│  /api/results    save · list · fetch · SVG share card        │
│  /metrics        Prometheus text exposition                  │
│  /               the SPA, embedded with go:embed             │
└──────────────────────────────────────────────────────────────┘
```

## Why this instead of LibreSpeed

- **One binary.** No PHP, no web server config, no separate frontend deploy.
- **Modern transport.** Downloads use `fetch` + streaming readers; uploads use
  XHR progress events, which is still the only portable way to watch bytes leave
  the browser.
- **Honest numbers by default.** Throughput is measured at the application
  layer, with a configurable grace period so TCP slow start does not drag the
  figure down. Overhead compensation exists but is off unless you ask for it.
- **Material You.** The whole palette is generated at runtime from one seed
  colour, in light and dark, and the visitor can change it.
- **Nookies.** The dial and the lift are one machine, with a reversing gear
  between them. The needle rides the hub gear; a yoke rocks the swing gear
  between the drum (two meshes, drum clockwise, car up) and a reversing gear
  (three meshes, drum anticlockwise, car down). So downloads send the car
  *down* the shaft and uploads wind it back *up*, and the car's travel is
  derived from the needle angle through the train rather than animated beside
  it. A beige bear rides inside. A plain circular dial is one menu click away
  for anyone who wants the boring version.

## Quick start

```sh
make build        # builds the SPA, embeds it, produces dist/speedtestd
./dist/speedtestd # listens on :8080
```

Then open <http://localhost:8080>.

Requires **Go 1.25+** and **Node 20.19+** to build; the resulting binary needs
neither.

## How the measurement works

**Latency.** The client sends `ping_count` empty requests back to back, after
`ping_warmup` throwaway probes. Where the browser exposes Resource Timing (the
server sends `Timing-Allow-Origin: *`, so this works cross-origin too) the round
trip is taken as `responseStart - requestStart`, which excludes the scheduling
and body-handling overhead a wall-clock measurement around `fetch` would
include. The headline **Ping** is the *minimum* round trip — the propagation
floor, and the same statistic LibreSpeed reports, so numbers stay comparable
during a migration. Minimum and maximum are stored alongside it.

**Jitter** is the mean absolute difference between consecutive round trips.

**Throughput.** `download_streams` (or `upload_streams`) workers run
concurrently for the configured duration. Bytes are accumulated continuously,
but the reported figure covers only the window *after* `grace_seconds` — during
the first second or so TCP is still growing its congestion window, and including
it would systematically understate a fast link. The gauge shows a shorter
trailing window so it stays responsive; the final number is the whole
measurement window.

**Why parallel streams.** A single TCP connection on a high bandwidth-delay
link is limited by window size and by any single packet loss. Six streams is
enough to saturate a gigabit LAN and most WAN links; raise it for 10 GbE.

**Payload.** The server holds a 16 MiB pool of `crypto/rand` bytes and serves
from a rotating offset, so no two streams send the same bytes in the same order.
Responses carry `Content-Encoding: identity` and `Cache-Control: no-store`, so
nothing on the path can compress or cache its way to a fictional result. You can
verify this: `curl -s 'localhost:8080/api/download?bytes=1048576' | gzip | wc -c`
returns *more* than 1048576.

**Upload accounting.** `XMLHttpRequest.upload.onprogress` reports bytes handed
to the socket, which can lead the wire by whatever is sitting in the kernel send
buffer. Over a ten-second window that is well under a percent. The server
returns the byte count it actually received so the two can be reconciled.

## Configuration

Layered: built-in defaults → JSON file → `SPEEDTEST_*` environment → flags.

```sh
speedtestd -config /etc/speedtest/speedtest.json
speedtestd -dump-config          # print the effective config and exit
speedtestd -listen :9000 -db /var/lib/speedtest/speedtest.db
```

See [`speedtest.example.json`](speedtest.example.json) for every field.

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

Common environment overrides: `SPEEDTEST_LISTEN`, `SPEEDTEST_DB`,
`SPEEDTEST_TITLE`, `SPEEDTEST_SEED_COLOR`, `SPEEDTEST_TRUSTED_PROXIES`,
`SPEEDTEST_DOWNLOAD_STREAMS`, `SPEEDTEST_ANONYMIZE_IP`,
`SPEEDTEST_IPINFO_ENABLED`.

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

## API

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

## Deploying

Copy `dist/speedtestd` to `/usr/local/bin`, the config to
`/etc/speedtest/speedtest.json`, and install the unit:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin speedtest
sudo install -m755 dist/speedtestd /usr/local/bin/speedtestd
sudo install -Dm644 deploy/speedtest.service /etc/systemd/system/speedtest.service
sudo systemctl enable --now speedtest
```

Behind a reverse proxy, two settings matter more than usual, because getting
them wrong produces a *wrong number* rather than an error:

- **Turn buffering off** in both directions. The server already sends
  `X-Accel-Buffering: no` for nginx; see [`deploy/nginx.conf`](deploy/nginx.conf)
  and [`deploy/Caddyfile`](deploy/Caddyfile) for the rest.
- **Turn compression off** for the measurement endpoints.

Also set `trusted_proxies`, or every result will be recorded against the proxy's
address.

## Development

```sh
make dev-api   # backend on :8080 with debug logging
make dev       # Vite dev server on :5173, proxying /api to :8080
make check     # gofmt, go vet, go test, tsc --noEmit
make test      # Go tests only
```

`npm --prefix web run build:preview` builds a standalone component playground
(the lift, the dial, the stat tiles, every palette) with no backend needed.

```
cmd/speedtestd        entry point, flags, graceful shutdown
internal/config       layered configuration and validation
internal/server       routing, middleware, JSON API, embedded SPA
internal/speed        ping, download, upload, concurrency limiter
internal/store        SQLite persistence
internal/netutil      client address resolution behind proxies
internal/ipinfo       optional ISP lookup with caching
internal/share        SVG result card
internal/metrics      Prometheus counters
web/src/engine        the measurement engine (latency, transfer, runner)
web/src/ui            components: lift scene, dial, tiles, history
web/src/theme.ts      Material You palette generation
```

### Building on a separate host

This tree is developed on one machine and built on another. `./sync-to-build.sh`
mirrors the source to the build host; set `BUILD_HOST` and `BUILD_DEST` to point
it somewhere else.

```sh
./sync-to-build.sh
ssh guillaume@10.0.50.21 'cd ~/build/speedtest && make check && make build'
```

## Licence

Internal project — no licence chosen yet.
