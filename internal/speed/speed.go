// Package speed implements the three measurement endpoints: latency probe,
// download source and upload sink.
package speed

import (
	"crypto/rand"
	"encoding/json"
	"io"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nebuloss/megapet/internal/session"
)

// poolBytes is the size of the pre-generated incompressible payload. Requests
// read from a rotating offset inside it so no two streams send the same bytes
// in the same order, which keeps middlebox caches and dedupe out of the way.
const poolBytes = 16 << 20

// writeChunk is the size of a single Write to the client. Large enough that the
// net/http buffer flushes immediately and syscall overhead stays negligible.
const writeChunk = 256 << 10

// Limiter caps how many concurrent transfer streams the server will serve.
type Limiter struct {
	perIP int
	total int

	mu     sync.Mutex
	counts map[netip.Addr]int
	active int
}

// NewLimiter returns a Limiter. A non-positive bound disables that dimension.
func NewLimiter(perIP, total int) *Limiter {
	return &Limiter{perIP: perIP, total: total, counts: make(map[netip.Addr]int)}
}

// Acquire reserves a stream slot for addr. The returned release function must
// be called exactly once when the stream ends.
func (l *Limiter) Acquire(addr netip.Addr) (release func(), ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.total > 0 && l.active >= l.total {
		return nil, false
	}
	if l.perIP > 0 && addr.IsValid() && l.counts[addr] >= l.perIP {
		return nil, false
	}
	l.active++
	if addr.IsValid() {
		l.counts[addr]++
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			l.active--
			if addr.IsValid() {
				if l.counts[addr] <= 1 {
					delete(l.counts, addr)
				} else {
					l.counts[addr]--
				}
			}
		})
	}, true
}

// Active reports the number of streams currently in flight.
func (l *Limiter) Active() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.active
}

// Handler serves the measurement endpoints.
type Handler struct {
	pool     []byte
	offset   atomic.Uint64
	maxBytes int64
	limiter  *Limiter

	// Counters, wired to the metrics registry by the caller.
	OnDownloadBytes func(int64)
	OnUploadBytes   func(int64)
	OnPing          func()
	OnRejected      func()

	// Sessions attributes bytes to the run that moved them, so the server can
	// record what it measured rather than what a client claims. Optional: with
	// no store, the endpoints still work and only the global counters move.
	Sessions *session.Store

	uploadBufs sync.Pool
}

// NewHandler pre-generates the payload pool and returns a ready Handler.
func NewHandler(maxBytes int64, limiter *Limiter) (*Handler, error) {
	pool := make([]byte, poolBytes)
	if _, err := rand.Read(pool); err != nil {
		return nil, err
	}
	if maxBytes <= 0 {
		maxBytes = 64 << 30
	}
	h := &Handler{pool: pool, maxBytes: maxBytes, limiter: limiter}
	h.uploadBufs.New = func() any {
		b := make([]byte, writeChunk)
		return &b
	}
	return h, nil
}

// noStore applies the headers every measurement response needs: no caching
// anywhere on the path, no transparent compression, and Resource Timing
// visibility so a cross-origin client can read accurate transfer timings.
func noStore(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	h.Set("Pragma", "no-cache")
	h.Set("Expires", "0")
	h.Set("Timing-Allow-Origin", "*")
	h.Set("X-Accel-Buffering", "no") // tell nginx not to buffer the stream
}

// Ping answers a latency probe with an empty 200. The client measures the time
// to first byte, so the response must carry no body and no compression.
func (h *Handler) Ping(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Length", "0")
	if h.OnPing != nil {
		h.OnPing()
	}
	w.WriteHeader(http.StatusOK)
}

// Download streams incompressible random bytes. The client aborts the request
// when its measurement window closes, so a short write is the normal ending.
func (h *Handler) Download(w http.ResponseWriter, r *http.Request) {
	addr := ClientAddr(r)
	release, ok := h.limiter.Acquire(addr)
	if !ok {
		h.reject(w)
		return
	}
	defer release()

	size := h.requestedSize(r, 1<<30)
	noStore(w)
	head := w.Header()
	head.Set("Content-Type", "application/octet-stream")
	head.Set("Content-Encoding", "identity")
	head.Set("Content-Disposition", `attachment; filename="random.dat"`)
	head.Set("Content-Length", strconv.FormatInt(size, 10))
	w.WriteHeader(http.StatusOK)

	// Start each stream at its own offset in the pool. A small stride gives
	// thousands of distinct phases rather than the 64 a chunk-sized stride
	// would, so concurrent streams are far less likely to send identical bytes
	// in the same order.
	off := int(h.offset.Add(4096) % (poolBytes - writeChunk))
	ctx := r.Context()

	sess := h.session(r)
	if sess != nil {
		sess.Begin(session.Down, time.Now())
		defer sess.End(session.Down, time.Now())
	}

	var sent int64
	for sent < size {
		if ctx.Err() != nil {
			break
		}
		n := int64(writeChunk)
		if remaining := size - sent; remaining < n {
			n = remaining
		}
		if off+int(n) > poolBytes {
			off = 0
		}
		written, err := w.Write(h.pool[off : off+int(n)])
		sent += int64(written)
		off += int(n)
		// Reported as it goes, not once at the end: a window that excludes the
		// ramp and the tail can only be drawn if the counter is watched while
		// it runs.
		if sess != nil && written > 0 {
			sess.Add(session.Down, int64(written), time.Now())
		}
		if err != nil {
			break // client hung up; expected at the end of the window
		}
	}
	if h.OnDownloadBytes != nil && sent > 0 {
		h.OnDownloadBytes(sent)
	}
}

// session returns the run this request belongs to, if it named one we know.
func (h *Handler) session(r *http.Request) *session.Session {
	if h.Sessions == nil {
		return nil
	}
	id := r.URL.Query().Get("session")
	if id == "" {
		return nil
	}
	sess, ok := h.Sessions.Get(id, ClientAddr(r))
	if !ok {
		return nil
	}
	return sess
}

// Upload consumes and discards the request body, reporting the byte count so
// the client can reconcile its own accounting against what actually arrived.
func (h *Handler) Upload(w http.ResponseWriter, r *http.Request) {
	addr := ClientAddr(r)
	release, ok := h.limiter.Acquire(addr)
	if !ok {
		h.reject(w)
		return
	}
	defer release()

	buf := h.uploadBufs.Get().(*[]byte)
	defer h.uploadBufs.Put(buf)

	sess := h.session(r)
	if sess != nil {
		sess.Begin(session.Up, time.Now())
		defer sess.End(session.Up, time.Now())
	}

	// io.Discard implements ReaderFrom, which io.CopyBuffer would prefer over
	// our buffer, falling back to an 8 KiB internal one. Wrapping it in a plain
	// Writer hides ReaderFrom and keeps the large reads.
	dst := struct{ io.Writer }{io.Discard}
	var src io.Reader = io.LimitReader(r.Body, h.maxBytes)
	if sess != nil {
		src = &metered{r: src, sess: sess}
	}
	n, err := io.CopyBuffer(dst, src, *buf)

	if h.OnUploadBytes != nil && n > 0 {
		h.OnUploadBytes(n)
	}
	if err != nil {
		// A client that aborts mid-upload is normal; report what we received.
		// Every error means the body was cut short, `io.ErrUnexpectedEOF`
		// included — it used to be routed to the "complete" reply, which told
		// the client a truncated upload had arrived whole.
		noStore(w)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{"bytes": n, "partial": true})
		return
	}
	noStore(w)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"bytes": n})
}

// metered reports bytes to a session as they are read, for the same reason
// the download loop does: the window that counts needs the counter watched
// while it runs, not totalled at the end.
type metered struct {
	r    io.Reader
	sess *session.Session
}

func (m *metered) Read(p []byte) (int, error) {
	n, err := m.r.Read(p)
	if n > 0 {
		m.sess.Add(session.Up, int64(n), time.Now())
	}
	return n, err
}

func (h *Handler) reject(w http.ResponseWriter) {
	if h.OnRejected != nil {
		h.OnRejected()
	}
	noStore(w)
	w.Header().Set("Retry-After", "5")
	http.Error(w, "too many concurrent streams", http.StatusServiceUnavailable)
}

func (h *Handler) requestedSize(r *http.Request, fallback int64) int64 {
	raw := r.URL.Query().Get("bytes")
	if raw == "" {
		raw = r.URL.Query().Get("ckSize") // LibreSpeed spelling, in MiB
		if raw != "" {
			if mib, err := strconv.ParseInt(raw, 10, 64); err == nil && mib > 0 {
				return min(mib<<20, h.maxBytes)
			}
		}
		return min(fallback, h.maxBytes)
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return min(fallback, h.maxBytes)
	}
	return min(n, h.maxBytes)
}

// clientAddrKey carries the resolved client address through the middleware
// chain so handlers do not need the proxy resolver.
type clientAddrKey struct{}

// WithClientAddr returns a request carrying addr.
func WithClientAddr(r *http.Request, addr netip.Addr) *http.Request {
	return r.WithContext(contextWithAddr(r.Context(), addr))
}

// ClientAddr returns the address stored by WithClientAddr, or the socket peer.
func ClientAddr(r *http.Request) netip.Addr {
	if a, ok := addrFromContext(r.Context()); ok {
		return a
	}
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return netip.Addr{}
	}
	return ap.Addr().Unmap()
}
