// Command megapetd is a self-contained network speedtest server: measurement
// endpoints, a SQLite result history and an embedded web frontend in one binary.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/nebuloss/megapet/internal/config"
	"github.com/nebuloss/megapet/internal/metrics"
	"github.com/nebuloss/megapet/internal/netutil"
	"github.com/nebuloss/megapet/internal/server"
	"github.com/nebuloss/megapet/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "megapetd:", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		configPath  = flag.String("config", "", "path to a JSON config file")
		listen      = flag.String("listen", "", "address to listen on (overrides config)")
		dbPath      = flag.String("db", "", "SQLite database path (overrides config)")
		logLevel    = flag.String("log-level", "info", "debug, info, warn or error")
		logFormat   = flag.String("log-format", "text", "text or json")
		showVersion = flag.Bool("version", false, "print version and exit")
		dumpConfig  = flag.Bool("dump-config", false, "print the effective config as JSON and exit")
	)
	flag.Parse()

	if *showVersion {
		fmt.Println("megapetd", server.Version)
		return nil
	}

	cfg := config.Default()
	if *configPath != "" {
		if err := cfg.LoadFile(*configPath); err != nil {
			return err
		}
	}
	if err := cfg.LoadEnv(); err != nil {
		return err
	}
	if *listen != "" {
		cfg.Listen = *listen
	}
	if *dbPath != "" {
		cfg.Store.Path = *dbPath
	}
	if err := cfg.Normalize(); err != nil {
		return err
	}

	// Derived after Normalize, because it depends on the resolved listen
	// address and on this host's interfaces.
	if cfg.Direct.Enabled && cfg.Direct.URL == "" {
		if url, ok := netutil.DirectURL(cfg.Listen, cfg.TLS.Enabled()); ok {
			cfg.Direct.URL = url
		}
	}

	log := newLogger(*logLevel, *logFormat)

	if *dumpConfig {
		return printConfig(cfg)
	}

	ctx, stop := signal.NotifyContext(context.Background(),
		os.Interrupt, syscall.SIGTERM)
	defer stop()

	var db *store.DB
	if cfg.Store.Enabled {
		var err error
		if db, err = store.Open(ctx, cfg.Store.Path); err != nil {
			return err
		}
		defer db.Close()
		log.Info("result store opened", "path", cfg.Store.Path)
		if cfg.Store.RetentionDays > 0 {
			go pruneLoop(ctx, log, db, cfg.Store.RetentionDays)
		}
	}

	reg := metrics.New()
	srv, err := server.New(cfg, log, db, reg)
	if err != nil {
		return err
	}

	httpSrv := &http.Server{
		Addr:    cfg.Listen,
		Handler: srv.Handler(),
		// No read or write timeout: a download stream is deliberately long
		// lived. ReadHeaderTimeout still bounds slowloris-style header stalls.
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelDebug),
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening",
			"addr", cfg.Listen,
			"direct", cfg.Direct.URL,
			"tls", cfg.TLS.Enabled(),
			"version", server.Version,
			"store", cfg.Store.Enabled,
			"ipinfo", cfg.IPInfo.Enabled)
		var err error
		if cfg.TLS.Enabled() {
			err = httpSrv.ListenAndServeTLS(cfg.TLS.CertFile, cfg.TLS.KeyFile)
		} else {
			err = httpSrv.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		log.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		// In-flight transfer streams may still be running; closing them is the
		// correct outcome for a restart.
		log.Warn("graceful shutdown incomplete", "error", err)
		return httpSrv.Close()
	}
	return nil
}

func newLogger(level, format string) *slog.Logger {
	var lv slog.Level
	if err := lv.UnmarshalText([]byte(strings.ToLower(level))); err != nil {
		lv = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: lv}
	if strings.EqualFold(format, "json") {
		return slog.New(slog.NewJSONHandler(os.Stderr, opts))
	}
	return slog.New(slog.NewTextHandler(os.Stderr, opts))
}

func printConfig(cfg config.Config) error {
	enc := newIndentedJSON(os.Stdout)
	return enc.Encode(cfg)
}

// pruneLoop deletes results past the retention window, once at startup and
// daily thereafter.
func pruneLoop(ctx context.Context, log *slog.Logger, db *store.DB, days int) {
	tick := time.NewTicker(24 * time.Hour)
	defer tick.Stop()
	for {
		cutoff := time.Now().AddDate(0, 0, -days)
		n, err := db.Prune(ctx, cutoff)
		switch {
		case err != nil && ctx.Err() == nil:
			log.Error("prune results", "error", err)
		case n > 0:
			log.Info("pruned old results", "count", n, "older_than", cutoff.Format(time.RFC3339))
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
