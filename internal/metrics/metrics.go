// Package metrics exposes a handful of counters in Prometheus text format
// without pulling in the client library.
package metrics

import (
	"fmt"
	"net/http"
	"sync/atomic"
	"time"
)

// Registry holds the process counters.
type Registry struct {
	start time.Time

	TestsStarted   atomic.Int64
	ResultsSaved   atomic.Int64
	DownloadBytes  atomic.Int64
	UploadBytes    atomic.Int64
	PingRequests   atomic.Int64
	Rejected       atomic.Int64
	ActiveStreams  atomic.Int64
	IPInfoLookups  atomic.Int64
	IPInfoFailures atomic.Int64
}

// New returns a Registry stamped with the process start time.
func New() *Registry { return &Registry{start: time.Now()} }

// Handler renders the counters in the Prometheus text exposition format.
func (r *Registry) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")

		type metric struct {
			name, help, typ string
			value           float64
		}
		for _, m := range []metric{
			{"megapet_uptime_seconds", "Seconds since process start.", "gauge", time.Since(r.start).Seconds()},
			{"megapet_tests_started_total", "Test sessions started.", "counter", float64(r.TestsStarted.Load())},
			{"megapet_results_saved_total", "Results written to the store.", "counter", float64(r.ResultsSaved.Load())},
			{"megapet_download_bytes_total", "Bytes served by the download endpoint.", "counter", float64(r.DownloadBytes.Load())},
			{"megapet_upload_bytes_total", "Bytes consumed by the upload endpoint.", "counter", float64(r.UploadBytes.Load())},
			{"megapet_ping_requests_total", "Latency probe requests served.", "counter", float64(r.PingRequests.Load())},
			{"megapet_rejected_total", "Requests rejected by the concurrency limiter.", "counter", float64(r.Rejected.Load())},
			{"megapet_active_streams", "Download/upload streams in flight.", "gauge", float64(r.ActiveStreams.Load())},
			{"megapet_ipinfo_lookups_total", "Outbound ISP lookups attempted.", "counter", float64(r.IPInfoLookups.Load())},
			{"megapet_ipinfo_failures_total", "Outbound ISP lookups that failed.", "counter", float64(r.IPInfoFailures.Load())},
		} {
			fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n%s %g\n", m.name, m.help, m.name, m.typ, m.name, m.value)
		}
	})
}
