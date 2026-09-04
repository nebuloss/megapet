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
- `web/src/ui/visuals/lift` — the hero visual. The needle drives one gear pair
  that never leaves mesh, and that drives the sheave through a belt; crossing
  the belt is what reverses the lift. Do not reintroduce a gear that swings in
  and out of mesh: at this scale an idler bridging two gears is wider than the
  gap it would have to leave through, so it gets drawn straight through its
  neighbours. `layout.ts` is the scene, `markup.ts` the SVG, `lift.ts` the
  state and the shift's stages. `web/src/ui/visuals/dial.ts` is the alternative
  plain dial. Both satisfy `SpeedVisual`.
- The run has a shape, and the phases are paced to fit it: the car rests at the
  ground floor, is called up the shaft while the ping is taken, carries the
  download down, the upload up, and comes home when the results are in. The
  visual tells the runner how long to hold each part through `Pacing` —
  `settleMs()` before the probes, `open()` for the ride during them, and
  `transitionMs` for a reversal. Do not shorten a hold below the move it
  covers; the needle drives the car through the belt, so anything the machine
  is doing has to outlast whatever the needle is doing.
- `web/src/mech/drive.ts` — the drive train, and the one part of the library
  that is objects rather than functions, because these are the parts that carry
  state. A part drives the part it drives: `hub -> pair -> lay -> belt -> brake
  -> sheave -> car`. Two rules make it work. **Motion is passed as increments,
  never positions** — a train that sets absolute positions throws the car the
  length of the shaft the moment a ratio changes sign. **A part may decline** —
  a set brake refuses, a held carriage ignores its rope — which is how the
  model says the machine, not the mechanism, is in charge right now, and why a
  delta is always offered once and either used or dropped.
- The car's position is **carried state**, never computed from the reading. A
  formula like `anchor + sign * fraction * travel` teleports the car the moment
  `sign` flips, because the eased reading has not caught up yet. The rule lives
  in `web/src/ui/visuals/lift/carriage.ts` as a pure function, and
  `carriage.test.ts` simulates whole runs and fails if any single frame moves
  the car further than the needle's easing allows. The machine takes the car
  over whenever it moves it itself — home before a run, called up the shaft,
  into a floor when a leg ends, back to the ground floor after — and the belt
  has no say while it does. A reversal queues behind the landing, so
  `transitionMs` covers `LAND_MS + SHIFT_MS`.
- The dial scale is **logarithmic**, so animate the fraction, never the Mbps.
  Easing the value and converting per frame swept the needle across half the
  dial in the first frame of every phase.
- `web/src/ui/theme/controller.ts` — generates every `--md-sys-color-*` token
  from one seed. Stylesheets must only ever read those tokens, never hard-code
  a colour.

## Commands

- `make check` — format in place, vet, both test suites, tsc. Use while working.
- `make verify` — the same, read-only. This is what CI runs.
- `make preview` — standalone playground for the visuals, no backend needed.

## Public repository

This repo is public, so nothing in the tree may contain internal hostnames,
addresses or credentials. `scripts/sync-to-build.sh` deliberately has no
default host and exits if `BUILD_HOST` is unset.
