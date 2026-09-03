# Changelog

Notable changes, newest first. This project has not had a tagged release yet;
everything below is on `main`.

The format loosely follows [Keep a Changelog](https://keepachangelog.com), and
versions will follow [Semantic Versioning](https://semver.org) once tagged.

## Unreleased

### Added

- Go server with the three measurement endpoints: an empty-response latency
  probe, an incompressible download source served from a rotating offset in a
  16 MiB random pool, and an upload sink that reports the byte count it
  actually received.
- SQLite result history with share links, an SVG result card, rolling
  summaries and daily retention pruning. Pure-Go driver, so the binary stays
  CGO-free.
- Per-IP and global concurrent stream limiters.
- Layered configuration: built-in defaults, a JSON file, `MEGAPET_*`
  environment variables, then flags.
- Proxy-aware client address resolution, honouring forwarding headers only
  from configured CIDRs.
- Optional ISP/ASN lookup, off by default.
- Prometheus counters on `/metrics`, and `/healthz` including a store probe.
- `/empty.php` and `/garbage.php` aliases, so existing LibreSpeed probes keep
  working during a migration.
- TypeScript frontend with no framework. Downloads use streaming `fetch`
  readers; uploads use XHR progress events. A configurable grace period
  discards TCP slow start so the reported figure is not dragged down by the
  ramp.
- Material You theming: the whole palette is generated at runtime from one
  seed colour, in light and dark, and the visitor can change either.
- The hero visual — a speed dial geared to a lift carrying Nookies, reversed
  by crossing a belt — plus a plain dial as an alternative.
- A standalone mechanics library under `web/src/mech`: plane geometry, spur
  gears, belt drives, rope, springs and detents, with unit tests and no
  knowledge of the speedtest.
- A deliberate pause between phases so the direction change can be watched,
  its length asked for by whichever visual is mounted.
