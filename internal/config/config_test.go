package config

import (
	"strings"
	"testing"
)

func TestDefaultIsValid(t *testing.T) {
	cfg := Default()
	if err := cfg.Normalize(); err != nil {
		t.Fatalf("default config is invalid: %v", err)
	}
	if cfg.IPInfo.Timeout == 0 || cfg.IPInfo.CacheTTL == 0 {
		t.Error("Normalize did not derive the ipinfo durations")
	}
}

func TestNormalizeRejectsBadValues(t *testing.T) {
	tests := []struct {
		name string
		mut  func(*Config)
		want string
	}{
		{"no listener", func(c *Config) { c.Listen = "" }, "listen"},
		{"too many download streams", func(c *Config) { c.Test.DownloadStreams = 99 }, "download_streams"},
		{"zero upload streams", func(c *Config) { c.Test.UploadStreams = 0 }, "upload_streams"},
		{"grace exceeds duration", func(c *Config) { c.Test.GraceSeconds = 30 }, "grace_seconds"},
		{"implausible overhead", func(c *Config) { c.Test.OverheadFactor = 3 }, "overhead_factor"},
		{"tiny upload chunk", func(c *Config) { c.Test.UploadChunkBytes = 10 }, "upload_chunk_bytes"},
		{"store without a path", func(c *Config) { c.Store.Path = "" }, "store.path"},
		{"unknown ipinfo provider", func(c *Config) { c.IPInfo.Provider = "nope" }, "ipinfo.provider"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Default()
			tc.mut(&cfg)
			err := cfg.Normalize()
			if err == nil {
				t.Fatalf("Normalize accepted an invalid config")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Normalize() error = %q, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestNormalizeFixesMetricsPath(t *testing.T) {
	cfg := Default()
	cfg.Metrics.Path = "internal/metrics"
	if err := cfg.Normalize(); err != nil {
		t.Fatal(err)
	}
	if cfg.Metrics.Path != "/internal/metrics" {
		t.Errorf("Metrics.Path = %q, want a leading slash", cfg.Metrics.Path)
	}
}

func TestLoadEnv(t *testing.T) {
	t.Setenv("MEGAPET_LISTEN", "127.0.0.1:9000")
	t.Setenv("MEGAPET_DOWNLOAD_STREAMS", "8")
	t.Setenv("MEGAPET_DOWNLOAD_SECONDS", "7.5")
	t.Setenv("MEGAPET_STORE_ENABLED", "false")
	t.Setenv("MEGAPET_TRUSTED_PROXIES", "10.0.0.0/8, 192.168.0.0/16")

	cfg := Default()
	if err := cfg.LoadEnv(); err != nil {
		t.Fatalf("LoadEnv: %v", err)
	}
	if cfg.Listen != "127.0.0.1:9000" {
		t.Errorf("Listen = %q", cfg.Listen)
	}
	if cfg.Test.DownloadStreams != 8 {
		t.Errorf("DownloadStreams = %d", cfg.Test.DownloadStreams)
	}
	if cfg.Test.DownloadSeconds != 7.5 {
		t.Errorf("DownloadSeconds = %v", cfg.Test.DownloadSeconds)
	}
	if cfg.Store.Enabled {
		t.Error("Store.Enabled = true, want false")
	}
	if len(cfg.TrustedProxies) != 2 || cfg.TrustedProxies[1] != "192.168.0.0/16" {
		t.Errorf("TrustedProxies = %v", cfg.TrustedProxies)
	}
}

func TestLoadEnvRejectsMalformedNumbers(t *testing.T) {
	t.Setenv("MEGAPET_PING_COUNT", "many")
	cfg := Default()
	if err := cfg.LoadEnv(); err == nil {
		t.Fatal("LoadEnv accepted a non-numeric ping count")
	}
}
