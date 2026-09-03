# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## What you need

- **Go 1.25+** — the module sets the floor; `go.mod` is the source of truth.
- **Node 20.19+ or 22+** — Vite 8 requires one of those.

Neither is needed to *run* the result: the build produces a single static
binary with the frontend embedded.

## Getting started

```sh
git clone https://github.com/nebuloss/megapet
cd megapet
make web-deps      # npm ci in web/
make build         # -> dist/megapetd
./dist/megapetd    # listens on :8080
```

For frontend work, run the two halves separately so you get hot reload:

```sh
make dev-api       # backend on :8080, verbose logging
make dev           # Vite on :5173, proxying /api to the backend
```

`make preview` builds a standalone playground for the hero visual with no
backend at all — handy for working on the mechanism.

## Before you open a pull request

```sh
make check         # gofmt (in place), go vet, both test suites, tsc
```

CI runs `make verify`, which is the same set but read-only — it fails rather
than reformatting. Run `make check` locally and the two agree.

## House style

- Match the surrounding code. The Go is stdlib-first; the frontend is plain
  TypeScript with no framework, and that is deliberate.
- **Comments explain why, not what.** Several non-obvious decisions in here are
  load-bearing and are commented as such; if you change one, update the comment.
- **Ratios in `web/src/mech` are tooth counts, never radii**, and every gear is
  cut to one module. Mixing modules is what makes teeth stop lining up.
- **The measurement engine's grace period is not an optimisation.** Discarding
  the first seconds of each phase is what stops TCP slow start dragging the
  figure down. Do not collapse the meter into total-bytes-over-total-time.
- The car's position in the lift visual is carried state, never recomputed from
  the reading — see the note in `CLAUDE.md` for why.

## Layout

Go follows the usual convention rather than a generic `src/`: entry points in
`cmd/`, everything else under `internal/` so it cannot be imported as a
library by accident. The frontend lives in `web/`, which is where the Go
ecosystem expects web assets.

```
cmd/megapetd      entry point, flags, graceful shutdown
internal/         the server: config, endpoints, store, share cards, metrics
web/src/engine    the browser-side measurement engine
web/src/mech      standalone mechanics library (geometry, gears, belts, rope)
web/src/ui        components: the lift scene, the dial, tiles, history
configs/          example configuration
deploy/           systemd unit and reverse proxy examples
docs/             the longer explanations
scripts/          development helpers
```

## Reporting a security issue

Please don't open a public issue — see [SECURITY.md](SECURITY.md).
