# megapet

Self-hosted speedtest: Go backend + TypeScript frontend, shipped as one static
binary (the SPA is embedded with `go:embed` from `internal/server/webdist`).

## Building

Do not build on the development machine — it is source-only. Mirror the tree
to the build host and build there:

```sh
BUILD_HOST=... ./scripts/sync-to-build.sh
ssh "$BUILD_HOST" 'cd ~/build/megapet && rtk make check && rtk make build'
```

The build host for this project is recorded in memory, not here, because this
file is public.

`npm ci` works with an older npm, but **regenerating** `package-lock.json`
needs npm 10+ — npm 9.2.0 fails with "Cannot read properties of null (reading
'edgesOut')". Use `npx --yes npm@10 install --package-lock-only`, then copy the
lockfile back before the next sync.

`go.mod` and `go.sum` are part of the source tree. `scripts/sync-to-build.sh`
uses `rsync --delete`, so after running `go mod tidy` on the build host, copy
them back here before syncing again or the change is lost.

## Invariants worth knowing

- `internal/speed` — the measurement endpoints. Changes here affect reported
  numbers; keep the no-store / identity-encoding headers intact.
- `web/src/engine` — the browser-side measurement engine. `grace_seconds` and
  the post-grace window are what make the figures honest; do not "simplify" the
  meter into a naive total-bytes-over-total-time calculation.
- `web/src/mech` — a standalone mechanics library: plane geometry, spur gears,
  belt drives, rope, springs and detents, plus the SVG path generation for all
  of them. It knows nothing about the speedtest and is covered by unit tests
  (`npm test` in `web/`). Ratios here are tooth counts, never radii, and every
  gear is cut to one module — mixing modules is what makes teeth stop lining up.
- `web/src/ui/lift` — the hero visual. The needle drives one gear pair that
  never leaves mesh, and that drives the sheave through a belt; crossing the
  belt is what reverses the lift. Do not reintroduce a gear that swings in and
  out of mesh: at this scale an idler bridging two gears is wider than the gap
  it would have to leave through, so it gets drawn straight through its
  neighbours. `layout.ts` is the scene, `markup.ts` the SVG, `index.ts` the
  state and the throw's stages. `web/src/ui/gauge.ts` is the alternative plain
  dial. Both satisfy `SpeedVisual`.
- The car's position is **carried state**, never computed from the reading. A
  formula like `anchor + sign * fraction * travel` teleports the car the moment
  `sign` flips, because the eased reading has not caught up yet.
- `web/src/theme.ts` — generates every `--md-sys-color-*` token from one seed.
  Stylesheets must only ever read those tokens, never hard-code a colour.

## Commands

- `make check` — format in place, vet, both test suites, tsc. Use while working.
- `make verify` — the same, read-only. This is what CI runs.
- `make preview` — standalone playground for the visuals, no backend needed.

## Public repository

This repo is public, so nothing in the tree may contain internal hostnames,
addresses or credentials. `scripts/sync-to-build.sh` deliberately has no
default host and exits if `BUILD_HOST` is unset.
