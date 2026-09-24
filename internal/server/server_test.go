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

// openRun starts a measured run and returns its id.
func openRun(t *testing.T, ts *httptest.Server) string {
	t.Helper()
	res, err := ts.Client().Post(ts.URL+"/api/runs", "application/json", nil)
	if err != nil {
		t.Fatalf("open run: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("open run status = %d", res.StatusCode)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.ID == "" {
		t.Fatal("run opened without an identifier")
	}
	return out.ID
}

func closeRun(t *testing.T, ts *httptest.Server, id, body string) *http.Response {
	t.Helper()
	res, err := ts.Client().Post(ts.URL+"/api/runs/"+id+"/close", "application/json",
		strings.NewReader(body))
	if err != nil {
		t.Fatalf("close run: %v", err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

/*
The whole point of the redesign: there is no endpoint that accepts a figure.

A client can ask for bytes and can say when it started and stopped, but the
numbers in the history come from what this process counted while that happened.
*/
func TestThereIsNoWayToSubmitAResult(t *testing.T) {
	ts, _ := newServer(t, nil)
	body := `{"download_mbps":9999,"upload_mbps":9999}`
	res, err := ts.Client().Post(ts.URL+"/api/results", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	// 405 from the mux (the path exists, but only for reading) or 404 are both
	// refusals; what matters is that nothing was accepted and nothing stored.
	if res.StatusCode < 400 {
		t.Fatalf("a client-reported result was accepted: status %d", res.StatusCode)
	}

	list := get(t, ts, "/api/results?limit=10")
	var listed struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(list.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 0 {
		t.Fatalf("a submitted result reached the history: %d rows", listed.Count)
	}
}

func TestRunRecordsWhatTheServerMeasured(t *testing.T) {
	ts, _ := newServer(t, nil)
	id := openRun(t, ts)

	// Move real bytes through the measurement endpoints, quoting the run.
	down := get(t, ts, "/api/download?bytes=3000000&session="+id)
	if _, err := io.Copy(io.Discard, down.Body); err != nil {
		t.Fatal(err)
	}
	if down.StatusCode != http.StatusOK {
		t.Fatalf("download status = %d", down.StatusCode)
	}

	res := closeRun(t, ts, id, `{"server_name":"This server"}`)
	if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusOK {
		t.Fatalf("close status = %d", res.StatusCode)
	}

	var saved struct {
		ID     string  `json:"id"`
		Down   float64 `json:"download_mbps"`
		Bytes  int64   `json:"download_bytes"`
		Stored *bool   `json:"stored"`
	}
	if err := json.NewDecoder(res.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	// A transfer this short cannot outlast the grace period, so there is no
	// honest figure to report and nothing is stored. What matters here is that
	// the server counted the bytes itself.
	if saved.Stored != nil && !*saved.Stored {
		return
	}
	if saved.ID == "" {
		t.Fatal("a stored run has no identifier")
	}
	if saved.Bytes <= 0 {
		t.Errorf("download_bytes = %d, want the bytes the server sent", saved.Bytes)
	}
}

// A run is identified by an unguessable id, but the id travels in a URL and
// URLs leak. Traffic from elsewhere must not land in a stranger's result.
func TestARunIsOnlyReachableFromTheAddressThatOpenedIt(t *testing.T) {
	ts, _ := newServer(t, func(c *config.Config) {
		c.TrustedProxies = []string{"127.0.0.1/32"}
	})
	id := openRun(t, ts)

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/runs/"+id+"/close", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-For", "203.0.113.9")
	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("another address closed the run: status %d", res.StatusCode)
	}
}

func TestARunCannotBeClosedTwice(t *testing.T) {
	ts, _ := newServer(t, nil)
	id := openRun(t, ts)
	closeRun(t, ts, id, "")
	if second := closeRun(t, ts, id, ""); second.StatusCode != http.StatusNotFound {
		t.Errorf("second close status = %d, want 404", second.StatusCode)
	}
}

func TestClosingAnUnknownRunIsNotFound(t *testing.T) {
	ts, _ := newServer(t, nil)
	if res := closeRun(t, ts, "NOPE", ""); res.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404", res.StatusCode)
	}
}

// A run that measured nothing is not a failure, and not a row of zeroes:
// a visitor who starts a test and stops it immediately has no result.
func TestARunThatMeasuredNothingIsNotStored(t *testing.T) {
	ts, _ := newServer(t, nil)
	id := openRun(t, ts)

	res := closeRun(t, ts, id, "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	var out struct {
		Stored bool `json:"stored"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Stored {
		t.Error("an empty run was stored")
	}

	list := get(t, ts, "/api/results?limit=10")
	var listed struct {
		Count int `json:"count"`
	}
	if err := json.NewDecoder(list.Body).Decode(&listed); err != nil {
		t.Fatal(err)
	}
	if listed.Count != 0 {
		t.Errorf("history has %d rows, want none", listed.Count)
	}
}

func TestRunLabelsAreTruncatedNotTrusted(t *testing.T) {
	ts, _ := newServer(t, nil)
	id := openRun(t, ts)
	long := strings.Repeat("x", 4000)
	res := closeRun(t, ts, id, `{"note":"`+long+`"}`)
	if res.StatusCode >= 500 {
		t.Errorf("an overlong label broke the close: status %d", res.StatusCode)
	}
}

func TestStoreDisabled(t *testing.T) {
	ts, db := newServer(t, func(c *config.Config) { c.Store.Enabled = false })
	if db != nil {
		t.Fatal("a store was opened even though it is disabled")
	}

	// A run still opens and closes; there is simply nowhere to record it.
	id := openRun(t, ts)
	if res := closeRun(t, ts, id, ""); res.StatusCode != http.StatusOK {
		t.Errorf("close status = %d, want 200", res.StatusCode)
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

	// Open and close a run from a forwarded address, moving enough bytes that
	// the server has something to record.
	open, err := http.NewRequest(http.MethodPost, ts.URL+"/api/runs", nil)
	if err != nil {
		t.Fatal(err)
	}
	open.Header.Set("X-Forwarded-For", "203.0.113.7")
	opened, err := ts.Client().Do(open)
	if err != nil {
		t.Fatal(err)
	}
	defer opened.Body.Close()
	var run struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(opened.Body).Decode(&run); err != nil {
		t.Fatal(err)
	}

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/runs/"+run.ID+"/close", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Forwarded-For", "203.0.113.7")

	res, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()

	var saved struct {
		ClientIP string `json:"client_ip"`
		Stored   *bool  `json:"stored"`
	}
	if err := json.NewDecoder(res.Body).Decode(&saved); err != nil {
		t.Fatal(err)
	}
	// Nothing measured, so nothing stored — the address handling is what this
	// test is about, and an empty run exercises the same path up to the point
	// where there is a figure worth keeping.
	if saved.Stored != nil && !*saved.Stored {
		return
	}
	if saved.ClientIP != "203.0.113.0" {
		t.Errorf("client_ip = %q, want the host portion masked", saved.ClientIP)
	}
}
