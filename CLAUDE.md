# speedtest

Self-hosted speedtest: Go backend + TypeScript frontend, shipped as one static
binary (the SPA is embedded with `go:embed` from `internal/server/webdist`).

## Building

Never build on this machine. Mirror the tree to the build host and build there:

```sh
./sync-to-build.sh
ssh guillaume@10.0.50.21 'cd ~/build/speedtest && rtk make check && rtk make build'
```

`go.mod` and `go.sum` are part of the source tree. `sync-to-build.sh` uses
`rsync --delete`, so after running `go mod tidy` on the build host, copy them
back here before syncing again or the change is lost.

## Layout

- `internal/speed` — the measurement endpoints. Changes here affect reported
  numbers; keep the no-store / identity-encoding headers intact.
- `web/src/engine` — the browser-side measurement engine. `grace_seconds` and
  the post-grace window are what make the figures honest; do not "simplify" the
  meter into a naive total-bytes-over-total-time calculation.
- `web/src/ui/liftscene.ts` — the default hero visual. The needle, all four
  gears, the cable and the car are derived from one angle in `paint()`; keep
  them coupled rather than animating any of them independently. The yoke seat
  angles (`YOKE_UP`, `YOKE_DOWN`) are solved from the gear mesh distances — if
  you move a gear, re-solve them or the teeth stop lining up. `setDrive()`
  re-anchors the car so reversing never teleports it.
  `web/src/ui/gauge.ts` is the alternative plain dial. Both satisfy
  `SpeedVisual`.
- `web/src/theme.ts` — generates every `--md-sys-color-*` token from one seed.
  Stylesheets must only ever read those tokens, never hard-code a colour.

`npm --prefix web run build:preview` renders a standalone playground for the
visuals with no backend running.
