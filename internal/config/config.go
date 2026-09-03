// Package config holds the runtime configuration for the speedtest server.
//
// Values are layered: built-in defaults, then an optional JSON file, then
// environment variables (MEGAPET_*), then command-line flags.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the full server configuration.
type Config struct {
	Listen  string `json:"listen"`
	BaseURL string `json:"base_url"`

	// TrustedProxies lists CIDRs allowed to set X-Forwarded-For/X-Real-IP.
	// Empty means the client IP is always taken from the socket.
	TrustedProxies []string `json:"trusted_proxies"`

	TLS     TLS     `json:"tls"`
	Direct  Direct  `json:"direct"`
	Test    Test    `json:"test"`
	Limits  Limits  `json:"limits"`
	Store   Store   `json:"store"`
	IPInfo  IPInfo  `json:"ipinfo"`
	UI      UI      `json:"ui"`
	Servers []Peer  `json:"servers"`
	Metrics Metrics `json:"metrics"`
}

// TLS serves the whole surface over https directly, without a proxy in front.
//
// Mostly worth it for one reason: a page served over https cannot measure
// against an http address, because browsers block it as mixed content. If you
// terminate TLS at a proxy and still want the direct measurement path, the
// server has to be able to speak https itself.
type TLS struct {
	CertFile string `json:"cert_file"`
	KeyFile  string `json:"key_file"`
}

// Enabled reports whether a certificate and key were both configured.
func (t TLS) Enabled() bool { return t.CertFile != "" && t.KeyFile != "" }

// Direct advertises an address that reaches this server without passing
// through a reverse proxy.
//
// A proxy is the honest answer to "how fast is this server for me", because it
// is how clients actually reach it. It is the wrong answer to "how fast is this
// link", because a proxy adds a copy per buffer and, misconfigured, can
// understate the result by an order of magnitude. Enabling this lets the page
// measure past it while still loading, and saving its results, through it.
type Direct struct {
	Enabled bool `json:"enabled"`
	// URL to measure against. Left empty, it is derived from `listen` at
	// startup — which guesses on a multi-homed host, so set it explicitly if
	// the guess is wrong.
	URL string `json:"url"`
}

// Test controls the measurement parameters handed to the browser.
type Test struct {
	PingCount        int     `json:"ping_count"`
	PingWarmup       int     `json:"ping_warmup"`
	DownloadSeconds  float64 `json:"download_seconds"`
	UploadSeconds    float64 `json:"upload_seconds"`
	GraceSeconds     float64 `json:"grace_seconds"`
	DownloadStreams  int     `json:"download_streams"`
	UploadStreams    int     `json:"upload_streams"`
	UploadChunkBytes int64   `json:"upload_chunk_bytes"`

	// OverheadFactor scales reported throughput to account for TCP/IP+Ethernet
	// framing. 1.0 reports application-layer bytes only (the honest default);
	// 1.06 approximates line rate the way some consumer tools do.
	OverheadFactor float64 `json:"overhead_factor"`
}

// Limits protect the server from a single client saturating it.
type Limits struct {
	MaxBytesPerRequest int64 `json:"max_bytes_per_request"`
	MaxStreamsPerIP    int   `json:"max_streams_per_ip"`
	MaxStreamsTotal    int   `json:"max_streams_total"`
}

// Store configures result persistence.
type Store struct {
	Enabled       bool   `json:"enabled"`
	Path          string `json:"path"`
	RetentionDays int    `json:"retention_days"`
	RecordIP      bool   `json:"record_ip"`
	AnonymizeIP   bool   `json:"anonymize_ip"`
}

// IPInfo configures ISP/ASN lookup for the client address.
type IPInfo struct {
	// Enabled turns on outbound lookups. Off by default: an internal
	// speedtest should not phone home unless you ask it to.
	Enabled  bool          `json:"enabled"`
	Provider string        `json:"provider"` // "ipapi" or "ipinfo"
	Token    string        `json:"token"`
	Timeout  time.Duration `json:"-"`
	CacheTTL time.Duration `json:"-"`

	TimeoutMS  int `json:"timeout_ms"`
	CacheTTLMS int `json:"cache_ttl_ms"`
}

// UI is passed verbatim to the frontend.
type UI struct {
	Title       string `json:"title"`
	SeedColor   string `json:"seed_color"`
	ShowHistory bool   `json:"show_history"`
	AutoStart   bool   `json:"auto_start"`
}

// Peer is another speedtest backend the client may select.
type Peer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	URL      string `json:"url"`
	Location string `json:"location,omitempty"`
	Default  bool   `json:"default,omitempty"`
}

// Metrics configures the Prometheus text endpoint.
type Metrics struct {
	Enabled bool   `json:"enabled"`
	Path    string `json:"path"`
}

// Default returns the built-in configuration.
func Default() Config {
	return Config{
		Listen:  ":8080",
		BaseURL: "",
		Direct:  Direct{Enabled: false},
		Test: Test{
			PingCount:        12,
			PingWarmup:       2,
			DownloadSeconds:  10,
			UploadSeconds:    10,
			GraceSeconds:     1.5,
			DownloadStreams:  6,
			UploadStreams:    4,
			UploadChunkBytes: 8 << 20,
			OverheadFactor:   1.0,
		},
		Limits: Limits{
			MaxBytesPerRequest: 64 << 30,
			MaxStreamsPerIP:    16,
			MaxStreamsTotal:    256,
		},
		Store: Store{
			Enabled:       true,
			Path:          "megapet.db",
			RetentionDays: 365,
			RecordIP:      true,
			AnonymizeIP:   false,
		},
		IPInfo: IPInfo{
			Enabled:    false,
			Provider:   "ipapi",
			TimeoutMS:  2500,
			CacheTTLMS: 6 * 60 * 60 * 1000,
		},
		UI: UI{
			Title:       "Megapet",
			SeedColor:   "#4F6BED",
			ShowHistory: true,
			AutoStart:   false,
		},
		Metrics: Metrics{Enabled: true, Path: "/metrics"},
	}
}

// LoadFile merges a JSON configuration file into c.
func (c *Config) LoadFile(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(c); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

// LoadEnv applies MEGAPET_* overrides.
func (c *Config) LoadEnv() error {
	str := func(k string, dst *string) {
		if v, ok := os.LookupEnv(k); ok {
			*dst = v
		}
	}
	num := func(k string, dst *int) error {
		v, ok := os.LookupEnv(k)
		if !ok {
			return nil
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			return fmt.Errorf("%s: %w", k, err)
		}
		*dst = n
		return nil
	}
	flt := func(k string, dst *float64) error {
		v, ok := os.LookupEnv(k)
		if !ok {
			return nil
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("%s: %w", k, err)
		}
		*dst = f
		return nil
	}
	bl := func(k string, dst *bool) error {
		v, ok := os.LookupEnv(k)
		if !ok {
			return nil
		}
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("%s: %w", k, err)
		}
		*dst = b
		return nil
	}

	str("MEGAPET_LISTEN", &c.Listen)
	str("MEGAPET_BASE_URL", &c.BaseURL)
	str("MEGAPET_DB", &c.Store.Path)
	str("MEGAPET_TITLE", &c.UI.Title)
	str("MEGAPET_SEED_COLOR", &c.UI.SeedColor)
	str("MEGAPET_TLS_CERT", &c.TLS.CertFile)
	str("MEGAPET_TLS_KEY", &c.TLS.KeyFile)
	str("MEGAPET_DIRECT_URL", &c.Direct.URL)
	str("MEGAPET_IPINFO_PROVIDER", &c.IPInfo.Provider)
	str("MEGAPET_IPINFO_TOKEN", &c.IPInfo.Token)
	if v, ok := os.LookupEnv("MEGAPET_TRUSTED_PROXIES"); ok {
		c.TrustedProxies = splitList(v)
	}
	for _, err := range []error{
		num("MEGAPET_DOWNLOAD_STREAMS", &c.Test.DownloadStreams),
		num("MEGAPET_UPLOAD_STREAMS", &c.Test.UploadStreams),
		num("MEGAPET_PING_COUNT", &c.Test.PingCount),
		num("MEGAPET_RETENTION_DAYS", &c.Store.RetentionDays),
		flt("MEGAPET_DOWNLOAD_SECONDS", &c.Test.DownloadSeconds),
		flt("MEGAPET_UPLOAD_SECONDS", &c.Test.UploadSeconds),
		flt("MEGAPET_OVERHEAD_FACTOR", &c.Test.OverheadFactor),
		bl("MEGAPET_STORE_ENABLED", &c.Store.Enabled),
		bl("MEGAPET_RECORD_IP", &c.Store.RecordIP),
		bl("MEGAPET_ANONYMIZE_IP", &c.Store.AnonymizeIP),
		bl("MEGAPET_DIRECT_ENABLED", &c.Direct.Enabled),
		bl("MEGAPET_IPINFO_ENABLED", &c.IPInfo.Enabled),
		bl("MEGAPET_METRICS_ENABLED", &c.Metrics.Enabled),
	} {
		if err != nil {
			return err
		}
	}
	return nil
}

// Normalize fills derived fields and validates the result.
func (c *Config) Normalize() error {
	c.IPInfo.Timeout = time.Duration(c.IPInfo.TimeoutMS) * time.Millisecond
	c.IPInfo.CacheTTL = time.Duration(c.IPInfo.CacheTTLMS) * time.Millisecond
	c.BaseURL = strings.TrimRight(c.BaseURL, "/")
	c.Direct.URL = strings.TrimRight(c.Direct.URL, "/")
	if c.Metrics.Path == "" {
		c.Metrics.Path = "/metrics"
	}
	if !strings.HasPrefix(c.Metrics.Path, "/") {
		c.Metrics.Path = "/" + c.Metrics.Path
	}

	var errs []error
	if c.Listen == "" {
		errs = append(errs, errors.New("listen must not be empty"))
	}
	if c.Test.DownloadStreams < 1 || c.Test.DownloadStreams > 32 {
		errs = append(errs, errors.New("test.download_streams must be 1..32"))
	}
	if c.Test.UploadStreams < 1 || c.Test.UploadStreams > 32 {
		errs = append(errs, errors.New("test.upload_streams must be 1..32"))
	}
	if c.Test.PingCount < 1 || c.Test.PingCount > 200 {
		errs = append(errs, errors.New("test.ping_count must be 1..200"))
	}
	if c.Test.DownloadSeconds <= 0 || c.Test.DownloadSeconds > 120 {
		errs = append(errs, errors.New("test.download_seconds must be 0..120"))
	}
	if c.Test.UploadSeconds <= 0 || c.Test.UploadSeconds > 120 {
		errs = append(errs, errors.New("test.upload_seconds must be 0..120"))
	}
	if c.Test.GraceSeconds < 0 || c.Test.GraceSeconds >= c.Test.DownloadSeconds {
		errs = append(errs, errors.New("test.grace_seconds must be >=0 and < download_seconds"))
	}
	if c.Test.OverheadFactor < 1 || c.Test.OverheadFactor > 1.5 {
		errs = append(errs, errors.New("test.overhead_factor must be 1.0..1.5"))
	}
	if c.Test.UploadChunkBytes < 64<<10 {
		errs = append(errs, errors.New("test.upload_chunk_bytes must be >= 65536"))
	}
	if c.Store.Enabled && c.Store.Path == "" {
		errs = append(errs, errors.New("store.path must be set when store.enabled"))
	}
	if (c.TLS.CertFile == "") != (c.TLS.KeyFile == "") {
		errs = append(errs, errors.New("tls.cert_file and tls.key_file must be set together"))
	}
	if c.Direct.URL != "" && !strings.HasPrefix(c.Direct.URL, "http://") &&
		!strings.HasPrefix(c.Direct.URL, "https://") {
		errs = append(errs, errors.New("direct.url must start with http:// or https://"))
	}
	switch c.IPInfo.Provider {
	case "ipapi", "ipinfo":
	default:
		errs = append(errs, fmt.Errorf("ipinfo.provider %q must be ipapi or ipinfo", c.IPInfo.Provider))
	}
	return errors.Join(errs...)
}

func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
