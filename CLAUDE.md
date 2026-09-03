# speedtest

Self-hosted speedtest: Go backend + TypeScript frontend, shipped as one static
binary (the SPA is embedded with `go:embed` from `internal/server/webdist`).

## Building

Never build on this machine. Mirror the tree to the build host and build there:

```sh
./sync-to-build.sh
ssh guillaume@10.0.50.21 'cd ~/build/speedtest && rtk make check && rtk make build'
```

`npm ci` works with the stock npm on dev-build, but **regenerating**
`package-lock.json` needs a newer one — npm 9.2.0 fails with "Cannot read
properties of null (reading 'edgesOut')". Use `npx --yes npm@10 install
--package-lock-only`, then copy the lockfile back here before the next sync.

`go.mod` and `go.sum` are part of the source tree. `sync-to-build.sh` uses
`rsync --delete`, so after running `go mod tidy` on the build host, copy them
back here before syncing again or the change is lost.

## Layout

- `internal/speed` — the measurement endpoints. Changes here affect reported
  numbers; keep the no-store / identity-encoding headers intact.
- `web/src/engine` — the browser-side measurement engine. `grace_seconds` and
  the post-grace window are what make the figures honest; do not "simplify" the
  meter into a naive total-bytes-over-total-time calculation.
- `web/src/mech` — a standalone mechanics library: plane geometry, spur gears,
  the tumbler reverse, rope bookkeeping, springs and detents, plus the SVG path
  generation for all of them. It knows nothing about the speedtest and is
  covered by unit tests (`npm test` in `web/`). Ratios here are tooth counts,
  never radii, and every gear is cut to one module — mixing modules is what
  makes teeth stop lining up.
- `web/src/ui/lift` — the hero visual built on that library. `layout.ts` derives
  the whole scene (the train, both yoke seats, the rope pin, the spring seat)
  rather than hard-coding angles; `markup.ts` is the SVG; `index.ts` holds the
  eased state and runs the throw's stages in order. `web/src/ui/gauge.ts` is the
  alternative plain dial. Both satisfy `SpeedVisual`.
- `web/src/theme.ts` — generates every `--md-sys-color-*` token from one seed.
  Stylesheets must only ever read those tokens, never hard-code a colour.

`npm --prefix web run build:preview` renders a standalone playground for the
visuals with no backend running.
