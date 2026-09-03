# Changelog

Notable changes, newest first.

The format loosely follows [Keep a Changelog](https://keepachangelog.com), and
versions follow [Semantic Versioning](https://semver.org).

## Unreleased

## 1.1.0 — 2026-09-03

### Added

- `direct`: optionally advertise an address that bypasses a reverse proxy, so
  the page loads and saves results through it while ping, download and upload
  go straight to the server. Derived from `listen` when not set explicitly,
  probed by the browser on load, and preferred automatically once it answers.
- `tls`: serve https directly. Chiefly so the direct measurement path is usable
  from an https page, which browsers otherwise block as mixed content. The
  certificate is re-read when it changes, so a renewal by certbot, Caddy or
  Nginx Proxy Manager is picked up without a restart; a reload that fails
  leaves the previous certificate serving rather than refusing connections.

### Fixed

- The example nginx config disabled gzip entirely, which cost every visitor
  about 100 kB because the bundle was served uncompressed. Compression is back
  on for the page and its assets; the measurement payloads are still never
  touched, because the server marks them `Content-Encoding: identity` and nginx
  skips any response that already declares an encoding.
- The hero visual left the car wherever the reading stopped, so a 940 Mbps
  download on a scale that reaches ten gigabits parked it three quarters of the
  way down and abandoned it there. Each leg now runs into the floor it was
  heading for, and the reversing gear waits for the car to stop before it
  shifts.
- The dial's graduations were not evenly spaced. `log10(1 + mbps)` shifted the
  scale, so the first decade got 50 degrees of a 270 degree sweep and the last
  got 67.5, with a dead 20 degree run before the "1". Every decade now gets a
  quarter of the dial, and the face says what it is counting.
- Animating the reading rather than its position on the scale swept the needle
  across 53% of the dial in the first frame of every phase, dragging the gear
  train and the car with it. Both visuals now animate the scale position.
- Zeroing the reading between phases moved the needle 36.6 degrees in one
  frame, which read as a reset rather than a return. It is now a timed sweep.
- Starting a second test snapped the needle to zero and threw the car back to
  the top floor. The car is driven home instead.
- `outline-variant` was used for boundaries that carry meaning, at 1.6:1
  against the surface where 3:1 is needed. Component borders now use `outline`.
- Dark Reader re-themed a page that already generates its own dark palette from
  a seed, inverting it twice over. The documented opt-out is now declared.
- Phone layout: the visual is capped shorter and the four figures sit in one
  row, so they are all on the first screen while a test runs.

## 1.0.0 — 2026-09-03

First public release.

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
- Cross-compiled releases for linux (amd64, arm64, armv7), macOS (amd64,
  arm64), FreeBSD (amd64) and Windows (amd64), published automatically on a
  version tag. The frontend is built once and embedded into every binary, so
  all platforms ship byte-identical assets.
- `scripts/install.sh`: detects the platform, verifies the archive's SHA-256
  against the published checksums, and installs with `--systemd` and
  `--uninstall` options. Escalates only where it has to.
- A frontend layered by responsibility — `core`, `api`, `domain`, `theme`,
  `routing`, and `ui` split into primitives, components, features and
  visuals — with the transfer phases as a Template Method hierarchy and the
  hero visuals behind a Strategy interface and factory.
