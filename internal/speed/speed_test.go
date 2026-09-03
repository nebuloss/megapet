package speed

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"sync"
	"testing"
)

func newHandler(t *testing.T, maxBytes int64, perIP, total int) *Handler {
	t.Helper()
	h, err := NewHandler(maxBytes, NewLimiter(perIP, total))
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	return h
}

func TestLimiterBounds(t *testing.T) {
	l := NewLimiter(2, 3)
	a := netip.MustParseAddr("10.0.0.1")
	b := netip.MustParseAddr("10.0.0.2")

	r1, ok := l.Acquire(a)
	if !ok {
		t.Fatal("first acquire for a was refused")
	}
	r2, ok := l.Acquire(a)
	if !ok {
		t.Fatal("second acquire for a was refused")
	}
	if _, ok := l.Acquire(a); ok {
		t.Error("third acquire for a should exceed the per-IP limit")
	}

	r3, ok := l.Acquire(b)
	if !ok {
		t.Fatal("a different address should still be admitted")
	}
	if _, ok := l.Acquire(b); ok {
		t.Error("acquire should be refused once the global limit is reached")
	}
	if got := l.Active(); got != 3 {
		t.Errorf("Active() = %d, want 3", got)
	}

	r1()
	r1() // releasing twice must not corrupt the count
	if got := l.Active(); got != 2 {
		t.Errorf("Active() after a double release = %d, want 2", got)
	}
	if _, ok := l.Acquire(a); !ok {
		t.Error("a slot freed by a release should be reusable")
	}

	r2()
	r3()
}

func TestLimiterIsConcurrencySafe(t *testing.T) {
	l := NewLimiter(0, 50)
	addr := netip.MustParseAddr("10.0.0.1")

	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if release, ok := l.Acquire(addr); ok {
				release()
			}
		}()
	}
	wg.Wait()
	if got := l.Active(); got != 0 {
		t.Errorf("Active() = %d after all releases, want 0", got)
	}
}

func TestPingIsEmptyAndUncacheable(t *testing.T) {
	h := newHandler(t, 1<<20, 4, 8)
	rec := httptest.NewRecorder()
	h.Ping(rec, httptest.NewRequest(http.MethodGet, "/api/ping", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("body = %d bytes, want 0", rec.Body.Len())
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q", cc)
	}
	// Cross-origin clients need this to read accurate Resource Timing values.
	if rec.Header().Get("Timing-Allow-Origin") != "*" {
		t.Error("Timing-Allow-Origin is not set")
	}
}

func TestDownloadHonoursRequestedSize(t *testing.T) {
	h := newHandler(t, 4<<20, 4, 8)

	rec := httptest.NewRecorder()
	h.Download(rec, httptest.NewRequest(http.MethodGet, "/api/download?bytes=65536", nil))
	if rec.Body.Len() != 65536 {
		t.Errorf("served %d bytes, want 65536", rec.Body.Len())
	}
	if got := rec.Header().Get("Content-Length"); got != "65536" {
		t.Errorf("Content-Length = %q", got)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "identity" {
		t.Errorf("Content-Encoding = %q, want identity so nothing compresses the stream", got)
	}
}

func TestDownloadCapsAtTheConfiguredMaximum(t *testing.T) {
	h := newHandler(t, 1<<20, 4, 8)
	rec := httptest.NewRecorder()
	h.Download(rec, httptest.NewRequest(http.MethodGet, "/api/download?bytes=999999999999", nil))
	if rec.Body.Len() != 1<<20 {
		t.Errorf("served %d bytes, want the 1 MiB cap", rec.Body.Len())
	}
}

// LibreSpeed clients ask for a size in MiB via ckSize.
func TestDownloadAcceptsLibreSpeedSizeParameter(t *testing.T) {
	h := newHandler(t, 8<<20, 4, 8)
	rec := httptest.NewRecorder()
	h.Download(rec, httptest.NewRequest(http.MethodGet, "/garbage.php?ckSize=2", nil))
	if rec.Body.Len() != 2<<20 {
		t.Errorf("served %d bytes, want 2 MiB", rec.Body.Len())
	}
}

func TestDownloadPayloadIsIncompressible(t *testing.T) {
	h := newHandler(t, 4<<20, 4, 8)
	rec := httptest.NewRecorder()
	h.Download(rec, httptest.NewRequest(http.MethodGet, "/api/download?bytes=262144", nil))

	body := rec.Body.Bytes()
	// Random data has a flat byte histogram; a payload of zeroes, or anything a
	// compressor could shrink, would show up as a badly skewed distribution.
	counts := make([]int, 256)
	for _, b := range body {
		counts[b]++
	}
	expected := len(body) / 256
	for value, n := range counts {
		if n < expected/2 || n > expected*2 {
			t.Fatalf("byte %d appears %d times, expected roughly %d — payload is not random", value, n, expected)
		}
	}
}

func TestDownloadStreamsStartAtDifferentOffsets(t *testing.T) {
	h := newHandler(t, 4<<20, 8, 8)
	req := httptest.NewRequest(http.MethodGet, "/api/download?bytes=4096", nil)

	first := httptest.NewRecorder()
	h.Download(first, req)
	second := httptest.NewRecorder()
	h.Download(second, req)

	if bytes.Equal(first.Body.Bytes(), second.Body.Bytes()) {
		t.Error("two streams served identical bytes; caches and dedupe could skew the measurement")
	}
}

func TestDownloadRejectedWhenSaturated(t *testing.T) {
	h := newHandler(t, 1<<20, 1, 1)
	release, ok := h.limiter.Acquire(netip.MustParseAddr("192.0.2.1"))
	if !ok {
		t.Fatal("could not fill the limiter")
	}
	defer release()

	rec := httptest.NewRecorder()
	h.Download(rec, httptest.NewRequest(http.MethodGet, "/api/download?bytes=1024", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("a rejected client was not told when to retry")
	}
}

func TestUploadCountsBytes(t *testing.T) {
	h := newHandler(t, 4<<20, 4, 8)
	payload := bytes.Repeat([]byte("x"), 128*1024)

	rec := httptest.NewRecorder()
	h.Upload(rec, httptest.NewRequest(http.MethodPost, "/api/upload", bytes.NewReader(payload)))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"bytes":131072`) {
		t.Errorf("response = %s, want the received byte count", rec.Body.String())
	}
}

func TestUploadStopsAtTheMaximum(t *testing.T) {
	const max = 64 << 10
	h := newHandler(t, max, 4, 8)

	rec := httptest.NewRecorder()
	body := io.LimitReader(neverEndingReader{}, 1<<20)
	h.Upload(rec, httptest.NewRequest(http.MethodPost, "/api/upload", body))

	if !strings.Contains(rec.Body.String(), `"bytes":65536`) {
		t.Errorf("response = %s, want the upload capped at %d bytes", rec.Body.String(), max)
	}
}

type neverEndingReader struct{}

func (neverEndingReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 'a'
	}
	return len(p), nil
}

func TestClientAddrFallsBackToThePeer(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/ping", nil)
	req.RemoteAddr = "203.0.113.7:1234"
	if got := ClientAddr(req); got.String() != "203.0.113.7" {
		t.Errorf("ClientAddr() = %s", got)
	}

	tagged := WithClientAddr(req, netip.MustParseAddr("198.51.100.9"))
	if got := ClientAddr(tagged); got.String() != "198.51.100.9" {
		t.Errorf("ClientAddr() after WithClientAddr = %s", got)
	}
}
