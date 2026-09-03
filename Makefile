# Builds run on the build host; this Makefile is meant to be invoked there.
BINARY      := speedtestd
CMD         := ./cmd/speedtestd
DIST        := dist
WEBDIST     := internal/server/webdist
VERSION     ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS     := -s -w -X github.com/nebuloss/speedtest/internal/server.Version=$(VERSION)
GOFLAGS     := -trimpath

.PHONY: all build backend web web-deps dev dev-api fmt vet test check clean tidy run

all: build

## build: compile the frontend into the binary and produce dist/speedtestd
build: web backend

backend:
	@mkdir -p $(DIST)
	CGO_ENABLED=0 go build $(GOFLAGS) -ldflags '$(LDFLAGS)' -o $(DIST)/$(BINARY) $(CMD)
	@echo "built $(DIST)/$(BINARY) ($(VERSION))"

web-deps:
	cd web && npm ci

## web: build the SPA and stage it where go:embed picks it up
web:
	cd web && npm run build
	@rm -rf $(WEBDIST)
	@mkdir -p $(WEBDIST)
	@cp -r web/dist/. $(WEBDIST)/
	@touch $(WEBDIST)/.gitkeep

## dev: Vite dev server (port 5173) proxying /api to a local backend
dev:
	cd web && npm run dev

## dev-api: backend only, with verbose logging
dev-api:
	go run $(CMD) -log-level debug

run: build
	$(DIST)/$(BINARY)

tidy:
	go mod tidy

fmt:
	gofmt -l -w .

vet:
	go vet ./...

test:
	go test ./...

check: fmt vet test
	cd web && npm run typecheck

clean:
	rm -rf $(DIST) web/dist node_modules web/node_modules
	rm -rf $(WEBDIST)
	@mkdir -p $(WEBDIST) && touch $(WEBDIST)/.gitkeep
