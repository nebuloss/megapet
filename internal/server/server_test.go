package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nebuloss/megapet/internal/config"
	"github.com/nebuloss/megapet/internal/metrics"
	"github.com/nebuloss/megapet/internal/store"
)

func newServer(t *testing.T, mutate func(*config.Config)) (*httptest.Server, *store.DB) {
	t.Helper()

	cfg := config.Default()
	cfg.Store.Path = filepath.Join(t.TempDir(), "test.db")
	if mutate != nil {
		mutate(&cfg)
	}
	if err := cfg.Normalize(); err != nil {
		t.Fatalf("config: %v", err)
	}

	var db *store.DB
	if cfg.Store.Enabled {
		var err error
		if db, err = store.Open(context.Background(), cfg.Store.Path); err != nil {
			t.Fatalf("store.Open: %v", err)
		}
		t.Cleanup(func() { db.Close() })
	}

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	srv, err := New(cfg, log, db, metrics.New())
	if err != nil {
		t.Fatalf("server.New: %v", err)
	}
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)
	return ts, db
}

func get(t *testing.T, ts *httptest.Server, path string) *http.Response {
	t.Helper()
	res, err := ts.Client().Get(ts.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func TestConfigEndpoint(t *testing.T) {
	ts, _ := newServer(t, func(c *config.Config) {
		c.UI.Title = "LAN Speedtest"
		c.Servers = []config.Peer{{ID: "b", Name: "Branch", URL: "https://b.example"}}
	})

	res := get(t, ts, "/api/config")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}

	var body struct {
		Title        string        `json:"title"`
		StoreEnabled bool          `json:"store_enabled"`
		Test         config.Test   `json:"test"`
		Servers      []config.Peer `json:"servers"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Title != "LAN Speedtest" {
		t.Errorf("title = %q", body.Title)
	}
	if !body.StoreEnabled {
		t.Error("store_enabled = false, want true")
	}
	if body.Test.DownloadStreams == 0 {
		t.Error("test parameters were not sent to the client")
	}
	if len(body.Servers) != 1 || body.Servers[0].Name != "Branch" {
		t.Errorf("servers = %+v", body.Servers)
	}
}

func TestResultRoundTrip(t *testing.T) {
	ts, _ := newServer(t, nil)

	payload := `{"download_mbps":942.31,"upload_mbps":918.4,"ping_ms":0.42,
		"jitter_ms":0.08,"ping_min_ms":0.39,"ping_max_ms":0.91,
		"download_bytes":1178000000,"upload_bytes":1148000000,
		"platform":"Firefox 142","server_id":"","server_name":"This server","note":""}`

	res, err := ts.Client().Post(ts.URL+"/api/results", "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("POST status = %d", res.StatusCode)
	}

	var saved struct {
		ID      string  `json:"id"`
		URL     string  `json:"url"`
		CardURL string  `json:"card_url"`
		Down    float64 `json:"download_mbps"`
	}
	if err := json.NewDecoder(res.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || saved.Down != 942.31 {
		t.Fatalf("unexpected saved result %+v", saved)
	}
	if !strings.HasSuffix(saved.URL, "/r/"+saved.ID) {
		t.Errorf("share URL = %q", saved.URL)
	}
	if !strings.Contains(saved.CardURL, saved.ID) {
		t.Errorf("card URL = %q", saved.CardURL)
	}

	if got := get(t, ts, "/api/results/"+saved.ID); got.StatusCode != http.StatusOK {
		t.Errorf("GET result status = %d", got.StatusCode)
	}

	card := get(t, ts, "/api/results/"+saved.ID+"/card.svg")
	if card.StatusCode != http.StatusOK {
		t.Fatalf("card status = %d", card.StatusCode)
	}
	if ct := card.Header.Get("Content-Type"); !strings.HasPrefix(ct, "image/svg+xml") {
		t.Errorf("card Content-Type = %q", ct)
	}

	list := get(t, ts, "/api/results?limit=10")
	var listed struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(list.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 1 {
		t.Errorf("list count = %d, want 1", listed.Count)
	}
}

func TestResultValuesAreClamped(t *testing.T) {
	ts, _ := newServer(t, nil)

	body := `{"download_mbps":1e30,"upload_mbps":-5,"ping_ms":1e9,"download_bytes":-1}`
	res, err := ts.Client().Post(ts.URL+"/api/results", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var saved struct {
		Down  float64 `json:"download_mbps"`
		Up    float64 `json:"upload_mbps"`
		Ping  float64 `json:"ping_ms"`
		Bytes int64   `json:"download_bytes"`
	}
	if err := json.NewDecoder(res.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.Down != 1e6 {
		t.Errorf("download_mbps = %v, want it clamped to 1e6", saved.Down)
	}
	if saved.Up != 0 || saved.Bytes != 0 {
		t.Errorf("negative values were not floored: up=%v bytes=%d", saved.Up, saved.Bytes)
	}
	if saved.Ping != 60000 {
		t.Errorf("ping_ms = %v, want it clamped to 60000", saved.Ping)
	}
}

func TestResultRejectsUnknownFields(t *testing.T) {
	ts, _ := newServer(t, nil)
	res, err := ts.Client().Post(ts.URL+"/api/results", "application/json",
		strings.NewReader(`{"download_mbps":1,"surprise":true}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", res.StatusCode)
	}
}

func TestStoreDisabled(t *testing.T) {
	ts, db := newServer(t, func(c *config.Config) { c.Store.Enabled = false })
	if db != nil {
		t.Fatal("a store was opened even though it is disabled")
	}

	res, err := ts.Client().Post(ts.URL+"/api/results", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotImplemented {
		t.Errorf("POST status = %d, want 501", res.StatusCode)
	}

	// Listing still answers, so the frontend does not need a special case.
	if got := get(t, ts, "/api/results"); got.StatusCode != http.StatusOK {
		t.Errorf("GET list status = %d, want 200", got.StatusCode)
	}
	if got := get(t, ts, "/api/config"); got.StatusCode != http.StatusOK {
		t.Errorf("config status = %d", got.StatusCode)
	}
}

func TestMeasurementEndpoints(t *testing.T) {
	ts, _ := newServer(t, nil)

	ping := get(t, ts, "/api/ping")
	if ping.StatusCode != http.StatusOK {
		t.Errorf("ping status = %d", ping.StatusCode)
	}

	down := get(t, ts, "/api/download?bytes=131072")
	body, err := io.ReadAll(down.Body)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != 131072 {
		t.Errorf("download served %d bytes, want 131072", len(body))
	}

	up, err := ts.Client().Post(ts.URL+"/api/upload", "application/octet-stream",
		strings.NewReader(strings.Repeat("x", 4096)))
	if err != nil {
		t.Fatal(err)
	}
	defer up.Body.Close()
	var got struct {
		Bytes int64 `json:"bytes"`
	}
	if err := json.NewDecoder(up.Body).Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got.Bytes != 4096 {
		t.Errorf("upload counted %d bytes, want 4096", got.Bytes)
	}
}

func TestCORSPreflight(t *testing.T) {
	ts, _ := newServer(t, nil)

	req, err := http.NewRequest(http.MethodOptions, ts.URL+"/api/upload", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", "https://speed.example")
	req.Header.Set("Access-Control-Request-Method", "POST")

	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", res.StatusCode)
	}
	if res.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Error("preflight did not allow the origin, so cross-server tests would fail")
	}
	if !strings.Contains(res.Header.Get("Access-Control-Allow-Methods"), "POST") {
		t.Errorf("Allow-Methods = %q", res.Header.Get("Access-Control-Allow-Methods"))
	}
}

func TestNoCORSHeadersWithoutAnOrigin(t *testing.T) {
	ts, _ := newServer(t, nil)
	if got := get(t, ts, "/api/config").Header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("same-origin response carried Access-Control-Allow-Origin = %q", got)
	}
}

func TestHealthAndMetrics(t *testing.T) {
	ts, _ := newServer(t, nil)

	health := get(t, ts, "/healthz")
	if health.StatusCode != http.StatusOK {
		t.Errorf("healthz status = %d", health.StatusCode)
	}

	m := get(t, ts, "/metrics")
	if m.StatusCode != http.StatusOK {
		t.Fatalf("metrics status = %d", m.StatusCode)
	}
	body, err := io.ReadAll(m.Body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "megapet_download_bytes_total") {
		t.Error("metrics output is missing the download counter")
	}
}

func TestMetricsCanBeDisabled(t *testing.T) {
	ts, _ := newServer(t, func(c *config.Config) { c.Metrics.Enabled = false })
	// With no /metrics route the SPA fallback answers instead, which must not
	// be the Prometheus payload.
	res := get(t, ts, "/metrics")
	body, _ := io.ReadAll(res.Body)
	if strings.Contains(string(body), "megapet_download_bytes_total") {
		t.Error("metrics are still exposed after being disabled")
	}
}

func TestSPARoutingFallback(t *testing.T) {
	ts, _ := newServer(t, nil)

	// A client-side route must resolve on a hard refresh...
	if got := get(t, ts, "/r/1PDASEXH1P").StatusCode; got != http.StatusOK {
		t.Errorf("SPA route status = %d, want 200", got)
	}
	// ...while a genuinely missing asset must still be a 404.
	if got := get(t, ts, "/assets/missing.js").StatusCode; got != http.StatusNotFound {
		t.Errorf("missing asset status = %d, want 404", got)
	}
}

func TestLibreSpeedCompatibilityAliases(t *testing.T) {
	ts, _ := newServer(t, nil)

	if got := get(t, ts, "/empty.php").StatusCode; got != http.StatusOK {
		t.Errorf("empty.php status = %d", got)
	}
	res := get(t, ts, "/garbage.php?ckSize=1")
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != 1<<20 {
		t.Errorf("garbage.php served %d bytes, want 1 MiB", len(body))
	}
}

func TestTrustedProxyAffectsRecordedIP(t *testing.T) {
	ts, _ := newServer(t, func(c *config.Config) {
		c.TrustedProxies = []string{"127.0.0.0/8", "::1/128"}
	})

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/api/ip", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-For", "203.0.113.7")

	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var info struct {
		IP      string `json:"ip"`
		Private bool   `json:"private"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.IP != "203.0.113.7" {
		t.Errorf("ip = %q, want the forwarded client address", info.IP)
	}
	if info.Private {
		t.Error("a public forwarded address was reported as private")
	}
}

func TestAnonymizedIPIsStored(t *testing.T) {
	ts, _ := newServer(t, func(c *config.Config) {
		c.TrustedProxies = []string{"127.0.0.0/8", "::1/128"}
		c.Store.AnonymizeIP = true
	})

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/results",
		strings.NewReader(`{"download_mbps":10}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Forwarded-For", "203.0.113.7")

	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var saved struct {
		ClientIP string `json:"client_ip"`
	}
	if err := json.NewDecoder(res.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	if saved.ClientIP != "203.0.113.0" {
		t.Errorf("client_ip = %q, want the host portion masked", saved.ClientIP)
	}
}
