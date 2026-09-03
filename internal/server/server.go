// Package server wires the HTTP surface: measurement endpoints, the results
// API and the embedded single-page frontend.
package server

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/nebuloss/megapet/internal/config"
	"github.com/nebuloss/megapet/internal/ipinfo"
	"github.com/nebuloss/megapet/internal/metrics"
	"github.com/nebuloss/megapet/internal/netutil"
	"github.com/nebuloss/megapet/internal/speed"
	"github.com/nebuloss/megapet/internal/store"
)

// Version is stamped at build time with -ldflags.
var Version = "dev"

// Server holds everything the handlers need.
type Server struct {
	cfg      config.Config
	log      *slog.Logger
	db       *store.DB // nil when persistence is disabled
	ip       *ipinfo.Lookup
	speed    *speed.Handler
	limiter  *speed.Limiter
	resolver *netutil.Resolver
	metrics  *metrics.Registry
}

// New assembles a Server. db may be nil.
func New(cfg config.Config, log *slog.Logger, db *store.DB, reg *metrics.Registry) (*Server, error) {
	resolver, err := netutil.NewResolver(cfg.TrustedProxies)
	if err != nil {
		return nil, err
	}
	limiter := speed.NewLimiter(cfg.Limits.MaxStreamsPerIP, cfg.Limits.MaxStreamsTotal)
	sh, err := speed.NewHandler(cfg.Limits.MaxBytesPerRequest, limiter)
	if err != nil {
		return nil, err
	}
	sh.OnDownloadBytes = func(n int64) { reg.DownloadBytes.Add(n) }
	sh.OnUploadBytes = func(n int64) { reg.UploadBytes.Add(n) }
	sh.OnPing = func() { reg.PingRequests.Add(1) }
	sh.OnRejected = func() { reg.Rejected.Add(1) }

	lookup := ipinfo.New(ipinfo.Options{
		Enabled:   cfg.IPInfo.Enabled,
		Provider:  cfg.IPInfo.Provider,
		Token:     cfg.IPInfo.Token,
		Timeout:   cfg.IPInfo.Timeout,
		CacheTTL:  cfg.IPInfo.CacheTTL,
		OnLookup:  func() { reg.IPInfoLookups.Add(1) },
		OnFailure: func() { reg.IPInfoFailures.Add(1) },
	})

	return &Server{
		cfg: cfg, log: log, db: db, ip: lookup,
		speed: sh, limiter: limiter, resolver: resolver, metrics: reg,
	}, nil
}

// Handler returns the fully wrapped HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// Measurement endpoints. The LibreSpeed-compatible aliases let existing
	// bookmarks and probes keep working during a migration.
	mux.HandleFunc("GET /api/ping", s.speed.Ping)
	mux.HandleFunc("HEAD /api/ping", s.speed.Ping)
	mux.HandleFunc("GET /api/download", s.speed.Download)
	mux.HandleFunc("POST /api/upload", s.speed.Upload)
	mux.HandleFunc("GET /empty.php", s.speed.Ping)
	mux.HandleFunc("POST /empty.php", s.speed.Upload)
	mux.HandleFunc("GET /garbage.php", s.speed.Download)

	// Metadata and results.
	mux.HandleFunc("GET /api/config", s.handleConfig)
	mux.HandleFunc("GET /api/ip", s.handleIP)
	mux.HandleFunc("POST /api/results", s.handleSaveResult)
	mux.HandleFunc("GET /api/results", s.handleListResults)
	mux.HandleFunc("GET /api/results/{id}", s.handleGetResult)
	mux.HandleFunc("GET /api/results/{id}/card.svg", s.handleResultCard)
	mux.HandleFunc("GET /api/summary", s.handleSummary)
	mux.HandleFunc("GET /healthz", s.handleHealth)

	if s.cfg.Metrics.Enabled {
		mux.HandleFunc("GET "+s.cfg.Metrics.Path, s.handleMetrics)
	}

	// Everything else is the SPA.
	mux.Handle("/", s.staticHandler())

	return s.withClientIP(s.withCORS(s.withLogging(s.withRecover(mux))))
}

// withRecover converts a handler panic into a 500 instead of killing the
// connection, and logs it with the request that caused it.
func (s *Server) withRecover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				if rec == http.ErrAbortHandler {
					panic(rec) // net/http's own signal; let it through
				}
				s.log.Error("panic serving request",
					"method", r.Method, "path", r.URL.Path, "panic", rec)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter { return s.ResponseWriter }

func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)

		// Transfer endpoints fire dozens of times per test; keep them off the
		// default log level.
		level := slog.LevelInfo
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/download"),
			strings.HasPrefix(r.URL.Path, "/api/upload"),
			strings.HasPrefix(r.URL.Path, "/api/ping"),
			strings.HasSuffix(r.URL.Path, ".php"),
			r.URL.Path == s.cfg.Metrics.Path:
			level = slog.LevelDebug
		}
		s.log.Log(r.Context(), level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", float64(time.Since(start).Microseconds())/1000,
			"client", netutil.String(speed.ClientAddr(r)))
	})
}

// withClientIP resolves the real client address once per request.
func (s *Server) withClientIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, speed.WithClientAddr(r, s.resolver.ClientIP(r)))
	})
}

// withCORS allows any origin to run a test against this backend. The endpoints
// are unauthenticated and carry no credentials, so this is safe and it is what
// makes a multi-server picker possible.
func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Expose-Headers", "Content-Length, Content-Type")
			h.Add("Vary", "Origin")
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				h.Set("Access-Control-Allow-Methods", "GET, POST, HEAD, OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Content-Type")
				h.Set("Access-Control-Max-Age", "86400")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
