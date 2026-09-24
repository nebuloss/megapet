// Package session records what the server itself measured, per test run.
//
// The point is trust. Results used to arrive from the browser in a POST: the
// browser measured the link, computed a figure and asked the server to store
// it. Nothing about that can be checked — a number is just a number once it is
// in a request body — so the history was, in effect, a list of things clients
// had claimed. It was also an unauthenticated write path into the database.
//
// So the server now measures for itself. It already counted every byte it sent
// and received; it simply threw the attribution away into a global counter.
// A session gives those bytes a name, and the row that ends up in the database
// is assembled from what this process observed: its own byte counts, its own
// clock, the socket's address, the request's user agent.
//
// The browser still shows live figures while a test runs, because that is what
// makes a speedtest worth watching. Those figures are just never stored.
//
// **Latency is deliberately absent.** A round trip can only be timed from the
// end that sends the first byte, and that is the browser. The server sees a
// request arrive and a response leave; it never observes the interval. It could
// infer something from the gaps between successive probes, but that number
// would carry the client's own scheduling jitter while wearing the name "ping",
// which is worse than not having it. Latency stays a live reading.
package session

import (
	"crypto/rand"
	"encoding/base32"
	"net/netip"
	"sync"
	"time"
)

// Direction of a transfer, from the server's point of view.
type Direction int

const (
	Down Direction = iota // bytes the server sent
	Up                    // bytes the server received
)

/*
Grace is how long a transfer is allowed to settle before it counts.

The same idea as the browser's: TCP opens its congestion window over the first
seconds, so bytes moved during the ramp describe the protocol warming up rather
than the link's capacity. Measuring across the ramp reports a figure lower than
the connection can actually sustain.

It has to be applied here as well as in the browser, or the two would disagree —
the server's figure would read low against the one the visitor just watched, and
a disagreement between the number on screen and the number in the history looks
like a bug even when both are computed exactly as documented.
*/
const Grace = 1500 * time.Millisecond

/*
Drain is how much of the tail of a download is discarded.

`Write` returning means the kernel accepted the bytes, not that the client
received them. At the end of a stream there is always a queue in flight —
socket buffer, NIC queue, everything between here and there — and counting it
as delivered overstates the result. The overstatement is proportional to how
long that queue takes to drain, so it is negligible on a fast link and large on
a slow one: a gigabit connection hides a few tenths of a percent, while ten
megabits behind a fat buffer can hide fifteen.

Rather than model the queue, the last part of the window is dropped. What
remains is an interior stretch where bytes counted and bytes delivered differ
only by a queue depth that was the same at both ends of it.
*/
const Drain = 750 * time.Millisecond

// Totals is what the server measured for one direction.
type Totals struct {
	// Bytes is everything moved, ramp and tail included.
	Bytes int64
	// Measured is what moved inside the window that counts.
	Measured int64
	// Window is how long that window lasted.
	Window time.Duration
	// Streams is how many transfers contributed.
	Streams int
}

// Mbps is the throughput over the measured window, or zero if there is none.
func (t Totals) Mbps() float64 {
	if t.Window <= 0 || t.Measured <= 0 {
		return 0
	}
	return float64(t.Measured) * 8 / t.Window.Seconds() / 1e6
}

// Session accumulates one visitor's run.
type Session struct {
	ID        string
	Addr      netip.Addr
	UserAgent string
	StartedAt time.Time

	mu        sync.Mutex
	legs      [2]leg
	lastTouch time.Time
}

// A single direction's accumulation.
type leg struct {
	// bytes counted since the session began.
	bytes int64
	// The window that counts: everything between `from` and `until`.
	started  time.Time
	from     time.Time
	fromByte int64
	until    time.Time
	byteAt   int64
	streams  int
	open     int
}

/*
Add records bytes moved, as they move.

Called repeatedly during a transfer rather than once at the end, which is what
lets the window exclude the ramp and the drain: the totals at the moment grace
expires, and again at the moment the tail begins, are only knowable if the
counter is being watched while it runs.
*/
func (s *Session) Add(d Direction, n int64, now time.Time) {
	if n <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	l := &s.legs[d]
	l.bytes += n
	s.lastTouch = now

	if l.started.IsZero() {
		l.started = now
	}
	// Once past the ramp, mark where the countable window begins.
	if l.from.IsZero() && now.Sub(l.started) >= Grace {
		l.from = now
		l.fromByte = l.bytes
	}
	if !l.from.IsZero() {
		l.until = now
		l.byteAt = l.bytes
	}
}

// Begin notes that a stream has opened.
func (s *Session) Begin(d Direction, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	l := &s.legs[d]
	l.streams++
	l.open++
	if l.started.IsZero() {
		l.started = now
	}
	s.lastTouch = now
}

// End notes that a stream has closed.
func (s *Session) End(d Direction, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.legs[d].open--
	s.lastTouch = now
}

/*
Totals reports what was measured in a direction.

The window ends `Drain` before the last byte counted, for the reason given on
that constant. A transfer too short to contain both a ramp and a drain has no
honest interior to report, and returns zero throughput rather than a figure
computed from the ramp.
*/
func (s *Session) Totals(d Direction) Totals {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.legs[d].totals()
}

func (l *leg) totals() Totals {
	t := Totals{Bytes: l.bytes, Streams: l.streams}
	if l.from.IsZero() || l.until.IsZero() {
		return t
	}
	end := l.until.Add(-Drain)
	if !end.After(l.from) {
		return t
	}
	// The drained tail is not measured, so the bytes attributed to it are
	// removed in proportion to the time removed. Anything else would divide
	// the full byte count by a shortened window and overstate the result.
	full := l.until.Sub(l.from)
	kept := end.Sub(l.from)
	moved := l.byteAt - l.fromByte
	t.Measured = int64(float64(moved) * kept.Seconds() / full.Seconds())
	t.Window = kept
	return t
}

// Idle reports how long since anything was recorded.
func (s *Session) Idle(now time.Time) time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return now.Sub(s.lastTouch)
}

// Active reports whether any stream is still open.
func (s *Session) Active() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.legs[Down].open > 0 || s.legs[Up].open > 0
}

/*
Store holds the sessions currently being measured.

Bounded, and swept: a session is created by an unauthenticated request, so an
unbounded map of them is a way to exhaust the server's memory from the outside.
Anything idle past its lifetime is dropped whether or not the client ever came
back to finish it.
*/
type Store struct {
	mu       sync.Mutex
	sessions map[string]*Session
	limit    int
	lifetime time.Duration
}

func NewStore(limit int, lifetime time.Duration) *Store {
	if limit <= 0 {
		limit = 512
	}
	if lifetime <= 0 {
		lifetime = 5 * time.Minute
	}
	return &Store{sessions: make(map[string]*Session), limit: limit, lifetime: lifetime}
}

// ErrFull is returned when too many sessions are already open.
type ErrFull struct{}

func (ErrFull) Error() string { return "too many sessions in progress" }

// Create opens a session, sweeping anything stale first.
func (s *Store) Create(addr netip.Addr, agent string, now time.Time) (*Session, error) {
	id, err := newID()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked(now)
	if len(s.sessions) >= s.limit {
		return nil, ErrFull{}
	}

	sess := &Session{
		ID:        id,
		Addr:      addr,
		UserAgent: agent,
		StartedAt: now,
		lastTouch: now,
	}
	s.sessions[id] = sess
	return sess, nil
}

/*
Get returns a session, but only to the address that opened it.

The id is unguessable, so this is defence in depth rather than the only lock on
the door. It matters because the id travels in a URL: query strings reach proxy
logs, browser history and `Referer` headers, and an id that leaks should not let
someone else's traffic be recorded against a stranger's result.
*/
func (s *Store) Get(id string, addr netip.Addr) (*Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok || sess.Addr != addr {
		return nil, false
	}
	return sess, true
}

// Close removes a session and hands it back for recording.
func (s *Store) Close(id string, addr netip.Addr) (*Session, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok || sess.Addr != addr {
		return nil, false
	}
	delete(s.sessions, id)
	return sess, true
}

// Len reports how many sessions are open.
func (s *Store) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}

// Sweep drops sessions that have gone quiet.
func (s *Store) Sweep(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweepLocked(now)
}

func (s *Store) sweepLocked(now time.Time) {
	for id, sess := range s.sessions {
		// A session with a stream still open is not idle, however long it has
		// been since the last chunk — a very slow link is not an abandoned one.
		if sess.Active() {
			continue
		}
		if sess.Idle(now) > s.lifetime {
			delete(s.sessions, id)
		}
	}
}

// newID returns an unguessable, URL-safe identifier.
func newID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:]), nil
}
