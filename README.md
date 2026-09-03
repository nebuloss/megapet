# Megapet

*Megabits, and a pet.*

A self-hosted network speedtest. A Go server and a TypeScript frontend that
ship as **one static binary** with no runtime dependencies — built as a
lighter, modern replacement for LibreSpeed, with a Material You interface, a
SQLite result history, and a bear called Nookies who rides a lift up and down
in time with your connection.

[![CI](https://github.com/nebuloss/megapet/actions/workflows/ci.yml/badge.svg)](https://github.com/nebuloss/megapet/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Go](https://img.shields.io/badge/go-1.25%2B-00ADD8.svg)](go.mod)

```
┌──────────────────────────────────────────────────────────────┐
│  megapetd  (single binary, ~11 MB, CGO-free)                 │
│                                                              │
│  /api/ping       empty 200s for latency and jitter           │
│  /api/download   incompressible random bytes, N streams      │
│  /api/upload     byte sink, N streams                        │
│  /api/results    save · list · fetch · SVG share card        │
│  /metrics        Prometheus text exposition                  │
│  /               the SPA, embedded with go:embed             │
└──────────────────────────────────────────────────────────────┘
```

## Quick start

```sh
make web-deps      # npm ci in web/
make build         # -> dist/megapetd
./dist/megapetd    # listens on :8080
```

Then open <http://localhost:8080>. Building needs **Go 1.25+** and **Node
20.19+**; the resulting binary needs neither.

## Why this instead of LibreSpeed

- **One binary.** No PHP, no web server config, no separate frontend deploy.
- **Modern transport.** Downloads use `fetch` with streaming readers; uploads
  use XHR progress events, still the only portable way to watch bytes leave
  the browser.
- **Honest numbers by default.** Throughput is measured at the application
  layer, with a configurable grace period so TCP slow start does not drag the
  figure down. Overhead compensation exists but is off unless you ask for it.
- **Material You.** The whole palette is generated at runtime from one seed
  colour, in light and dark, and the visitor can change it.
- **Drop-in migration.** `/empty.php` and `/garbage.php` aliases mean existing
  LibreSpeed probes and bookmarks keep working while you move over.
- **Nookies.** The speed dial is geared to a lift: downloads send the car down
  the shaft, uploads wind it back up, and the reversal happens by crossing a
  belt — which Nookies does himself, with a lever. `make preview` renders the
  mechanism on its own if you just want to play with it. A plain circular dial
  is one menu click away for anyone who wants the boring version.

## Repository layout

Go's convention rather than a generic `src/`: entry points in `cmd/`,
everything else under `internal/` so it cannot be imported as a library by
accident. The frontend lives in `web/`, which is where the Go ecosystem
expects web assets.

```
megapet/
├── cmd/megapetd/          entry point: flags, config layering, shutdown
├── internal/
│   ├── config/            layered configuration and validation
│   ├── server/            routing, middleware, JSON API, embedded SPA
│   ├── speed/             ping, download, upload, concurrency limiter
│   ├── store/             SQLite result persistence
│   ├── netutil/           client address resolution behind proxies
│   ├── ipinfo/            optional ISP lookup, with caching
│   ├── share/             SVG result card
│   └── metrics/           Prometheus counters
├── web/
│   ├── src/
│   │   ├── engine/        the browser-side measurement engine
│   │   ├── mech/          mechanics library: geometry, gears, belts, rope
│   │   ├── ui/            components: the lift scene, dial, tiles, history
│   │   ├── styles/        Material 3 tokens, base and components
│   │   └── theme.ts       palette generation from one seed colour
│   ├── preview/           standalone playground for the visuals
│   └── public/            static assets served as-is
├── configs/               example configuration
├── deploy/                systemd unit, nginx and Caddy examples
├── docs/                  the longer explanations
└── scripts/               development helpers
```

## Documentation

| | |
| --- | --- |
| [docs/measurement.md](docs/measurement.md) | What each phase counts, and what it deliberately throws away |
| [docs/configuration.md](docs/configuration.md) | Every setting, the environment overrides, multi-server setups |
| [docs/api.md](docs/api.md) | The HTTP surface, including the LibreSpeed aliases |
| [docs/deployment.md](docs/deployment.md) | systemd, and the two reverse-proxy settings that matter |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Development setup, house style, what the invariants are |
| [SECURITY.md](SECURITY.md) | Reporting, and what is unauthenticated **by design** |

## Configuration in one line

Layered: built-in defaults → JSON file → `MEGAPET_*` environment → flags.

```sh
megapetd -config /etc/megapet/megapet.json
megapetd -dump-config          # print the effective config and exit
megapetd -listen :9000 -db /var/lib/megapet/megapet.db
```

See [docs/configuration.md](docs/configuration.md) for the full set, and
[`configs/megapet.example.json`](configs/megapet.example.json) for a file with
every field in it.

## A note on trust

Results are measured by the browser, which is the only thing that can measure
the link, so the values cannot be verified server-side. They *are* clamped —
NaN, infinities and negatives become zero, absurd figures are capped — so a bad
client cannot poison the history. The measurement endpoints are deliberately
unauthenticated and CORS-permissive; [SECURITY.md](SECURITY.md) explains what
that does and does not mean.

## Licence

[MIT](LICENSE) © nebuloss.
