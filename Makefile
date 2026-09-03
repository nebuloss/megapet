BINARY      := megapetd
CMD         := ./cmd/megapetd
DIST        := dist
WEBDIST     := internal/server/webdist
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS     := -s -w -X github.com/nebuloss/megapet/internal/server.Version=$(VERSION)
GOFLAGS     := -trimpath

.PHONY: help all build backend web web-deps dev dev-api preview run \
        tidy fmt fmt-check vet test test-go test-web typecheck check verify clean

## help: list the targets worth knowing about
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /' | sort

all: build

## build: compile the frontend into the binary, producing dist/megapetd
build: web backend

backend:
	@mkdir -p $(DIST)
	CGO_ENABLED=0 go build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o $(DIST)/$(BINARY) $(CMD)
	@echo "built $(DIST)/$(BINARY) ($(VERSION))"

## web-deps: install the frontend's dependencies from the lockfile
web-deps:
	cd web && npm ci

## web: build the SPA and stage it where go:embed picks it up
web:
	cd web && npm run build
	@rm -rf $(WEBDIST)
	@mkdir -p $(WEBDIST)
	@cp -r web/dist/. $(WEBDIST)/
	@touch $(WEBDIST)/.gitkeep

## dev: Vite dev server on :5173, proxying /api to a local backend
dev:
	cd web && npm run dev

## dev-api: backend only, with verbose logging
dev-api:
	go run $(CMD) -log-level debug

## preview: standalone playground for the visuals, no backend needed
preview:
	cd web && npm run build:preview
	@echo "open web/preview-dist/index.html"

## run: build, then start the binary
run: build
	$(DIST)/$(BINARY)

tidy:
	go mod tidy

## fmt: format the Go sources in place
fmt:
	gofmt -l -w .

fmt-check:
	@unformatted=$$(gofmt -l .); \
	if [ -n "$$unformatted" ]; then \
		echo "not gofmt-clean:"; echo "$$unformatted"; exit 1; \
	fi

vet:
	go vet ./...

test-go:
	go test ./...

test-web:
	cd web && npm test

## test: run both test suites
test: test-go test-web

typecheck:
	cd web && npm run typecheck

## check: format in place, then vet, test and typecheck (use while developing)
check: fmt vet test typecheck

## verify: the same checks without modifying anything (use in CI)
verify: fmt-check vet test typecheck

clean:
	rm -rf $(DIST) web/dist web/preview-dist web/node_modules
	rm -rf $(WEBDIST)
	@mkdir -p $(WEBDIST) && touch $(WEBDIST)/.gitkeep
