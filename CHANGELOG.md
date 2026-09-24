# Changelog

Notable changes, newest first.

The format loosely follows [Keep a Changelog](https://keepachangelog.com), and
versions follow [Semantic Versioning](https://semver.org).

## 1.2.1 — 2026-09-24

### Changed

- **Builds are reproducible.** The same source and the same version now
  produce the same bytes wherever they are built, so a published binary can
  be checked against the tag it claims to come from. Go was stamping the
  commit and build time into every binary, which meant a release built by CI
  from a git checkout could never match one built from an exported tarball.
  CI asserts the property on every push.
- Node is pinned by `.nvmrc` rather than floating on a major version.

### Added

- `scripts/verify-release.sh <tag>`: rebuilds a published release from the
  current tree and compares it byte for byte. A checksum only tells you the
  download was not corrupted; this tells you what the binary was built from.
  Releases from 1.2.1 onwards can be verified this way — 1.2.0 predates the
  change and will not match.

## 1.2.0 — 2026-09-24

Results are now measured by the server rather than reported by the browser.
**This is a breaking change to the API and to the stored schema**, described
under *Removed* below.

### Added

- **Manual mode.** The staged run answers "how fast is this link right now"
  and stops; manual mode answers "what does it do over time". Choose download,
  upload or both — or neither, to record an idle baseline — and it runs until
  you stop it, plotting throughput on the same logarithmic scale the dial
  uses. It needed no new endpoint: the measurement endpoints already stream
  for as long as anyone reads or writes.
- **A graph**, opened over the page from the top bar. Zoom, pan, and a
  *follow* switch that is deliberately separate from zoom — you can be zoomed
  right in and following the live edge, or zoomed out and parked over
  something five minutes old. Both modes record into it, so a morning of spot
  checks reads as one picture.
- **CSV export** of a session: one row per sample, with both an elapsed offset
  and a wall-clock timestamp, so a dip can be lined up against a router graph.
- `POST /api/runs` and `POST /api/runs/{id}/close`, which open and close a
  measured run.
- Keyboard shortcuts: `G` for the graph, `D` and `U` for the directions,
  `Space` to start or stop.

### Changed

- **Upload no longer reads slower than download on a symmetric link.** Two
  causes, both in how hard the test tried rather than in the link: it opened
  four streams against download's six, and it sized each request for a quarter
  of a second, which on a fast link made request turnaround rather than the
  connection decide the figure.
- The page is one screen: the history scrolls within itself and the hero is
  bounded by viewport height.
- The mode switch lives in the top bar.
- Unknown paths are corrected in the address bar rather than merely rendering
  the application under a URL that no longer exists.
- Exports are named `megapet-<date>-<time>.csv`.
- The lift now rests at the ground floor rather than hanging at the top of its
  shaft, and the run has a shape to match: the car is called up while the ping
  is taken, carries the download down, the upload up, and comes home once the
  results are in. Journeys run at one speed, so a long ride reads as a ride.
- The needle's return to its stop between phases is slower again, 1600ms.
- Latency probes are no longer measured underneath the opening animation. A
  ping on a local link is a millisecond or two, small enough that one janked
  frame outweighs it, so the visual's settling move is allowed to finish first.
- Nookies is redrawn from the plush he is meant to be.

### Removed

- **`POST /api/results` is gone, and nothing replaces it.** Results used to
  arrive as a figure in a request body: the browser measured the link and
  asked the server to store the number. Nothing about that can be checked, so
  the history was a list of claims rather than measurements, and the endpoint
  was an unauthenticated write into the database. The server already counted
  every byte it sent and received — those bytes now belong to a named run, and
  the stored figures are the ones this process observed.
- **Latency is no longer stored.** A round trip can only be timed by the end
  that sends the first byte, and that is the browser. Inferring one from the
  gaps between probes would produce a number carrying the client's own
  scheduling jitter while wearing the name "ping". It is still measured and
  shown live; the `ping_ms`, `jitter_ms`, `ping_min_ms` and `ping_max_ms`
  columns are dropped, along with the ping figures in `/api/summary`.

### Fixed

- A truncated upload was reported to the client as complete.
- Unrouted `/api/` paths fell through to the frontend, so a removed endpoint
  answered with the application shell and a `200`.
- The server warns at startup when no trusted proxies are configured, where
  every visitor otherwise resolves to the proxy and silently shares one
  identity, one stream budget, and each other's runs.

### Upgrading

An existing database keeps working; SQLite ignores the dropped columns, and
old rows survive minus their latency figures. Anything that posted to
`/api/results` will now receive a `404` — there is deliberately no way to
submit a measurement.

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
