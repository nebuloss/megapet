# AGENTS.md

Megapet is a self-hosted network speedtest: a Go HTTP server plus a
framework-free TypeScript SPA, shipped as **one static binary** with the built
frontend embedded via `go:embed`.

`CLAUDE.md` is the committed, public-facing companion to this file and goes
deeper on the hero visual's mechanics. Read it before touching anything under
`web/src/mech` or `web/src/ui/visuals/lift`.

## Where things build

This machine is source-only: **do not build here**. Mirror the tree to the
build host and run the targets there:

```sh
BUILD_HOST=... ./scripts/sync-to-build.sh          # rsync --delete, no default host
ssh "$BUILD_HOST" 'cd ~/build/megapet && make check && make build'
```

`BUILD_DEST` overrides the remote path (default `~/build/megapet`). The script
deliberately has no default host, because this repo is public.

Running `go test ./...` or `npm test` locally for a quick check is fine — they
need no toolchain beyond what is installed — but anything whose **output ships**
is produced on the build host. When local and remote disagree, remote wins.

### Sync gotchas

- `sync-to-build.sh` uses `rsync --delete`. Anything generated remotely and not
  copied back (`go.mod`, `go.sum` after `go mod tidy`; `package-lock.json`) is
  destroyed on the next sync. Copy it back **before** syncing again.
- Regenerating `package-lock.json` needs npm 10+; npm 9.2.0 dies with "Cannot
  read properties of null (reading 'edgesOut')". Use
  `npx --yes npm@10 install --package-lock-only`.

## Commands

| Command | What it does |
| --- | --- |
| `make check` | gofmt **in place**, `go vet`, both test suites, `tsc`. Use while working. |
| `make verify` | Same set, read-only — fails instead of reformatting. This is CI. |
| `make build` | `make web` then `make backend` → `dist/megapetd`. |
| `make web-deps` | `npm ci` in `web/`. Required before any web target on a fresh tree. |
| `make dev` | Vite on :5173, proxying `/api` and `/healthz` to the backend. |
| `make dev-api` | `go run ./cmd/megapetd -log-level debug` on :8080. |
| `make preview` | Standalone visuals playground, **no backend** → `web/preview-dist/index.html`. |
| `make dist-all` | Cross-compiles 7 platforms with archives + checksums. |
| `make help` | Lists the documented targets. |

Narrower loops: `make test-go`, `make test-web`, `make typecheck`, `make vet`.
Inside `web/`: `npm test` (vitest run), `npm run test:watch`, `npm run typecheck`.
Single vitest file: `cd web && npx vitest run src/mech/gear.test.ts`.

`MEGAPET_BACKEND` points the Vite proxy somewhere other than
`http://127.0.0.1:8080`.

### The embed dance

`make web` builds `web/dist` and copies it into `internal/server/webdist/`,
which is `//go:embed all:webdist`. That directory is git-ignored apart from
`.gitkeep`, which must survive — without it the embed directive fails to
compile in a source-only checkout. A binary built without `make web` still
runs and serves a "Frontend not built" page (`internal/server/static.go`).

## Architecture

### Backend (`cmd/`, `internal/`)

Stdlib-only HTTP (Go 1.25, `net/http` method+pattern routing); the sole
non-test dependency is `modernc.org/sqlite` (pure Go, so `CGO_ENABLED=0`
everywhere and cross-compiling needs no toolchain).

```
cmd/megapetd      flags, logger, TLS, graceful shutdown
internal/config   layered config: defaults -> JSON file -> MEGAPET_* env -> flags
internal/server   routing, middleware chain, results API, embedded SPA
internal/speed    the three measurement endpoints + concurrency limiter
internal/store    SQLite results history
internal/netutil  client IP resolution behind trusted proxies
internal/ipinfo   optional ISP/ASN lookup with caching
internal/share    SVG share card rendering
internal/certs    hot-reloading TLS certificate pair
internal/metrics  Prometheus text-format counters
```

Request flow: `Server.Handler()` builds the mux, then wraps it
`withClientIP(withCORS(withLogging(withRecover(mux))))` — the client IP is
resolved outermost and stashed in the request context (`internal/speed/context.go`),
so every inner layer reads the same address.

Config must go through `cfg.Normalize()` before use; it fills derived values
(including `Direct.URL` from `listen`) and validates. `-dump-config` prints the
effective config.

Non-obvious backend invariants:

- **`internal/speed` headers are load-bearing.** No-store/no-cache plus
  identity encoding plus `Timing-Allow-Origin` — drop any of them and the
  reported numbers become fiction.
- The download payload is a pre-generated 16 MiB incompressible pool; each
  stream starts at a **rotating offset** so middleboxes cannot dedupe streams.
  `speed_test.go` asserts both properties.
- Results are **client-supplied and unverifiable**. The server clamps them
  (NaN/Inf/negatives → 0, absurd values capped) and rejects unknown JSON
  fields. Keep both when changing the submission shape.
- Forwarding headers are honoured **only** when the immediate peer matches
  `trusted_proxies`; `netutil` walks `X-Forwarded-For` right-to-left to the
  first untrusted hop.
- `GET /empty.php` and `GET /garbage.php?ckSize=N` are LibreSpeed compatibility
  aliases and are covered by tests. Do not remove them casually.
- Static serving: `/assets/*` is fingerprinted by Vite and cached immutably;
  everything else is `no-cache`, and unknown extension-less paths fall back to
  `index.html` so SPA routes like `/r/{id}` survive a hard refresh.

Go tests are plain `func TestX` with named helper constructors (`newServer(t,
mutate)`), `t.TempDir()` for databases, and `httptest`. No table-driven
convention and no test framework — match that.

### Frontend (`web/src`)

No framework, no runtime dependency except
`@material/material-color-utilities`. TypeScript is strict with
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`verbatimModuleSyntax` — type-only imports must say `import type`.

```
core/         View contract, Component base, Emitter, Preferences
api/          ApiClient facade; withBase() clones it for another peer
engine/       the measurement engine: runner, phases, meter, latency
mech/         standalone mechanics library (geometry, gears, belts, rope, SVG)
theme/        Material You: one seed -> every --md-sys-color-* token
routing/      tiny History API router
ui/app.ts     composition root — wiring only
ui/features/  the real behaviour: hero, test-controller, history, share, tiles
ui/visuals/   SpeedVisual implementations: lift/ and dial.ts
ui/primitives/ dom, format, icons, anim helpers
```

Control flow of a run: `TestController` (`ui/features/test-controller.ts`)
drives `SpeedTest` (`engine/runner.ts`) and forwards each `Snapshot` to the
mounted `SpeedVisual`. Phases are `idle -> latency -> reversing -> download ->
reversing -> upload -> done`, with fixed progress `WEIGHTS` per phase.

There is a second shape of test: **manual mode** (`engine/monitor.ts` +
`ui/features/monitor-panel.ts`). A two-position switch in the top bar
(`ui/features/mode-tabs.ts`) chooses between **Auto**, the staged run, and
**Manual**, the open-ended one, and the two are alternatives in the same place
— manual mode's controls replace the speed dial in the hero rather than
sitting below it. Routes: `/` auto, `/manual` manual controls. **The graph is a dialog, not a
route** (`ui/features/graph-modal.ts`): it opens over the page, which is left
exactly as it was underneath. It was a view of the page once, and everything
else had to get out of its way — tiles and history removed, columns
rearranged, the result tall enough to need scrolling past controls that had
not moved.

The dialog holds no content of its own: `MonitorPanel` is *moved* into it and
back out. That panel is the session, so rebuilding it there would throw away
the run it is drawing. Keeping the difference that small is what stops the
two views disagreeing about what is running, which is how the graph once ended
up offering manual's controls while auto mode was selected.

The primary button therefore belongs to the selected **mode**, not to the view:
in auto it starts and stops the staged run wherever you are, and manual's
direction switches become a read-only display of the run's phases. The graph
button lives in the top bar, since the graph is the record of what every mode
measured rather than a mode itself.

Changing mode while the graph is showing keeps you on the graph. The path does
not change there, so the router would treat the navigation as a no-op —
`commitMode` sets the mode before navigating to cover both cases in one path. Note the naming seam: the UI says "manual mode", the code still
says `Monitor`/`MonitorPanel`.

`MonitorPanel` has two layouts and one instance. `setCompact(true)` is the
hero: switches, start, and a way through to the graph. `setCompact(false)` is
the graph page. Same element, re-parented, so a session started from either
keeps running when the other is shown. It runs
download, upload or both until stopped, plots throughput over time, and saves
nothing — but it does export: `engine/export.ts` renders the session as CSV,
one row per sample with both an elapsed offset and a wall-clock timestamp. It deliberately does not implement `SpeedVisual` — that interface is
about a staged run, and `both` is the case that settles it, since a lift cannot
travel up and down at once. It needed no backend change: the measurement
endpoints already stream for as long as anyone reads or writes.

Non-obvious frontend invariants:

- **`SpeedVisual` (`ui/visuals/visual.ts`) is the seam.** The lift and the dial
  are interchangeable; `ui/visuals/factory.ts` is the only place naming the
  concrete classes. Adding a visual means one entry there and nothing else.
- **The visual paces the run.** `settleMs()`, `open()` and `transitionMs` tell
  the runner how long to hold each part. Never shorten a hold below the move it
  covers.
- **`durationMs: Infinity` is the endless phase.** For such a phase an abort is
  the normal ending and returns a result; for a phase with a window it is a
  failure and throws. `progress` stays 0 rather than creeping towards an end
  that never comes. `phases/transfer-phase.test.ts` pins both halves.
- **The monitor takes two switches, not three modes.** `Directions {down, up}`;
  there is no `'both'` value to keep in step. Turning off the last direction
  turns the other on rather than leaving a test that measures nothing.
- **Directions can be thrown mid-session.** Each is a `Leg` with its own abort
  controller, so switching one off leaves the other, the clock and the history
  untouched; `Monitor.setDirections` reconciles them. A tick arriving after its
  stint was stopped is dropped, or the reading revives after the line ended.
- **The monitor's graph draws on a frame loop, not on samples.** The history
  gains a point a second; the axis follows the clock and the newest reading is
  drawn as a provisional point at "now" (`ui/visuals/leading-edge.ts`), for
  *whichever* test is running. Drawn only from committed samples the line grows
  in once-a-second jumps, which is the staircase this removes.
- **The leading edge must chase the *live* reading, not the last recorded
  sample.** Feeding it the last sample draws a flat stub out to the edge and
  then steps when the next sample lands, which is the opposite of the point.
  The staged run pushes its reading in through `onLive`.
- **`ui/visuals/viewport.ts` owns zoom, pan and focus, and keeps them apart.**
  Zoom is how much time fits; pan is where the window sits; **focus** is
  whether it follows the live edge. They are not the same question — you can
  be zoomed right in and following, or zoomed out and parked over something
  five minutes old. Panning turns focus off, because a live chart that snaps
  back to "now" when you let go cannot be used to look at anything else.
- **The window is always one span wide and anchored to the newest reading**
  (`LEAD_POSITION`), even seconds into a session: data scrolls in from the
  right. Pinning the left edge at `t=0` while young leaves "now" a third of
  the way across with empty space ahead of it, which reads as a graph that
  has stopped.
- **The line is a monotone cubic spline, not a polyline** (`monotoneSlopes`).
  Monotone specifically: an ordinary spline overshoots around a sharp change,
  drawing a dip below the floor and a hump above the peak — on a throughput
  graph that is a speed that never happened, contradicting the peak the same
  panel reports.
- **Points outside the window are culled, not clamped** (`visible`). `xFor`
  clamps, so an off-window point lands on the frame and a session's worth of
  them piles up as a block of stroke.
- **The time axis counts up from the session start**, never back from "now".
  A feature then keeps its label as the graph scrolls, and the numbers match
  the `elapsed_s` column of an exported CSV.
- **Zoom is bounded by the session's own length**; zooming out past the
  beginning only buys empty axis. Panning is bounded at both ends too.
- **The timeline only advances while something is running.** Advancing it from
  the last sample unconditionally made a stopped graph scroll itself off into
  empty axis, and "follow" return to a `now` containing no data.
- **A trace is drawn for any direction that *has data*, never for whichever is
  switched on now** (`hasData`). In auto mode the switches follow the run's
  current phase, so keying the trace off them erased the download history the
  instant the run moved on to the upload leg.
- **A phase boundary is never dropped by the sample throttle.** The reversal
  emits a single zero as the download ends and then says nothing for several
  seconds; throttled away, the curve drew straight across that gap as a long
  gentle decline the link never performed.
- **An export describes the series it is exporting**, taking both its start
  time and its columns from the data. Reading them off the manual session
  wrote every row of a staged run with two empty columns.
- **The plot reserves `AXIS_GUTTER` at the bottom** for the time labels, which
  also keeps a zero line off the edge where its stroke would be half clipped.
- **The compact panel needs an explicit grid column.** Sized to its widest
  child, the plot changed width whenever the button text did — starting a
  session relabelled it and the graph narrowed under the cursor.
- **The stat tiles are the page's readout for whichever test is running.**
  Manual mode reports through `onReadings`; without it the tiles sat at a dash
  through a whole session.
- **The leading edge eases the fraction, never the Mbps** — the same rule as
  the dial's needle, for the same reason: the axis is logarithmic, so easing
  the value makes the line leap most of a decade in one frame and then crawl.
- **Nothing per-frame may build DOM.** The decade grid depends only on the
  plot's size and is rebuilt only when that changes; rebuilding it every frame
  held the redraw to about fifteen a second.
- **The treadmill follows whichever test is loading the link**, not just
  manual's own session. Tied to the panel's `running` flag alone, Nookies stood
  still through an entire staged run that was drawing a graph underneath him.
- **Nookies' colours live on `:root`, not on `.lift`.** He appears on both
  screens; scoped to the lift he renders as an unpainted silhouette anywhere
  else.
- **Both directions at once is not two independent measurements.** Upload and
  download share the link. Report it as "what the link does when pushed both
  ways", never as two capacities; the panel says so on screen.
- **An unmeasured direction exports as empty, never zero.** Zero is a
  measurement, and a column of zeroes is what later gets averaged into a
  report.
- **Redraw loops reschedule before doing the work, never after.** A frame that
  threw used to leave the handle set with nothing scheduled, so the loop was
  dead and could never restart: the graph froze while the readouts beside it
  carried on.
- **The page is one screen.** `.hero` is bounded by viewport height and the
  history scrolls inside itself, because the visual is the only part that can
  give — the reading, the button and the chips are all a fixed size.
- **Unknown paths are rewritten, not just rendered.** The server serves the app
  for anything, so a stale URL like `/graph` would otherwise render the right
  page under a wrong address that can be bookmarked and shared. `Router`
  replaces rather than pushes, or going back would re-correct in a loop.
- **Single-key shortcuts** (`ui/shortcuts.ts`): G graph, D/U directions, Space
  start/stop. Suppressed while typing and whenever a modifier is held, so
  nothing shadows a browser or assistive-technology binding.
- **The top bar and mode tabs stay above the scrim.** The bar's graph button
  is a toggle, so covering it leaves the control that opened the dialog unable
  to close it; the tabs matter because the graph shows whichever mode is
  selected. The scrim also stops below the bar rather than relying on paint
  order.
- **The monitor panel outlives its page.** It is built once in `App` and
  re-parented when shown, so a session keeps running while you look at the
  speed test and the graph is still growing when you come back. Nothing on
  navigation may stop it — that is what forced a confirmation dialog the first
  time round, and the dialog was the wrong fix.
- **While the staged run holds the link, manual mode shows what *it* is doing**
  — the switches follow the run's phase (upload reads on during the upload
  leg), the graph keeps drawing, and the switches are locked. A control that
  shows a stale setting next to a live graph stops being believed.
- **Only one test may run at a time.** Within a mode that is said by disabling
  the other's button with the reason on it. *Changing* mode while something is
  running asks first (`ui/components/confirm-dialog.ts`), because the switch
  would stop it and a manual session may have been left going for a long time.
  An idle switch never asks. The dialog is bespoke rather than
  `window.confirm`, which blocks the main thread and would freeze the very
  measurement it is asking about. They share one link, so running both
  has each measuring a link the other is saturating. A dialog was tried and is
  worse: it asks after the click rather than telling you before it.
- **`TimeSeries` figures come from raw samples, not from the drawn points.**
  Compaction averages pairs, so a peak read off the graph shrinks the longer a
  session runs. Merged points also take the *earlier* timestamp, or the start
  of the session walks forward on every compaction.
- **The graph shares the dial's log scale** (`visuals/scale.ts`), so the two
  never disagree about where a reading sits, and a 20 Mbps link stays readable
  on an axis that reaches 10 Gbps.
- **The grace period is not an optimisation.** `RateMeter.markGrace()` discards
  the TCP slow-start ramp; `final()` measures only the post-grace window while
  `live()` uses a short trailing window for the gauge. Do not collapse this into
  total-bytes-over-total-time.
- **The scale is logarithmic** (`ui/visuals/scale.ts`). Animate the *fraction*,
  never the Mbps — easing the value and converting per frame throws the needle
  across half the dial on the first frame of every phase.
- **`mech` ratios are tooth counts, never radii**, and every gear is cut to one
  module; `GearPair` refuses to exist otherwise.
- **Motion in `mech/drive.ts` is passed as increments, never positions**, and a
  part may decline to move. Both rules are what stop the car teleporting when a
  ratio changes sign.
- **The lift car's position is carried state**, never `anchor + sign * fraction
  * travel`. `machine/machine.test.ts` replays whole runs and fails if any
  single frame moves the car further than the needle's easing permits.
- **Stylesheets read `--md-sys-color-*` tokens only.** Never hard-code a colour;
  the whole palette is generated in `theme/controller.ts` from one seed.

Web tests are vitest in a **node** environment (`vitest.config.ts`) — there is
no DOM, so testable logic must stay out of element code. `mech` exports a
`RecordingScene` test double that captures what a machine would draw; use it
rather than stubbing SVG.

## Conventions

- `.editorconfig`: LF, final newline, 2-space indent; tabs for Go and the
  Makefile. Markdown keeps trailing whitespace.
- **Comments explain why, not what.** Many here are load-bearing decisions —
  if you change the behaviour, update the comment in the same edit.
- Go is stdlib-first; the frontend is plain TypeScript, deliberately.
- `internal/` is used so nothing can be imported as a library by accident.
- This repository is **public**. No internal hostnames, addresses or
  credentials anywhere in the tree, including in examples.

## Docs worth reading before large changes

`docs/api.md` (endpoint table), `docs/measurement.md` (why the numbers are what
they are), `docs/configuration.md`, `docs/deployment.md`, `CONTRIBUTING.md`.
