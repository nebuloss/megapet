package session

import (
	"net/netip"
	"testing"
	"time"
)

func addr(s string) netip.Addr {
	a, err := netip.ParseAddr(s)
	if err != nil {
		panic(err)
	}
	return a
}

func newSession(t *testing.T) *Session {
	t.Helper()
	store := NewStore(0, 0)
	sess, err := store.Create(addr("10.0.0.1"), "agent", time.Unix(0, 0))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return sess
}

// feed moves `mbps` for `dur`, in 100ms steps, starting at `from`.
func feed(s *Session, d Direction, from time.Time, dur time.Duration, mbps float64) time.Time {
	step := 100 * time.Millisecond
	perStep := int64(mbps * 1e6 / 8 * step.Seconds())
	at := from
	for elapsed := time.Duration(0); elapsed < dur; elapsed += step {
		at = from.Add(elapsed)
		s.Add(d, perStep, at)
	}
	return at
}

func TestThroughputIsMeasuredOverTheInteriorWindow(t *testing.T) {
	s := newSession(t)
	start := time.Unix(100, 0)
	feed(s, Down, start, 10*time.Second, 100)

	got := s.Totals(Down).Mbps()
	if got < 95 || got > 105 {
		t.Fatalf("expected about 100 Mbps, got %.1f", got)
	}
}

// The ramp is what the grace period exists to exclude: TCP opening its
// congestion window describes the protocol warming up, not the link.
func TestTheRampDoesNotDragTheFigureDown(t *testing.T) {
	s := newSession(t)
	start := time.Unix(100, 0)

	// Two seconds crawling, then eight at full rate.
	at := feed(s, Down, start, 2*time.Second, 5)
	feed(s, Down, at.Add(100*time.Millisecond), 8*time.Second, 100)

	got := s.Totals(Down).Mbps()
	if got < 90 {
		t.Fatalf("ramp dragged the figure to %.1f Mbps", got)
	}
}

/*
Bytes written are not bytes delivered: at the end of a stream there is always a
queue in flight. Counting it as delivered overstates the result, so the tail is
dropped — and the bytes attributed to it have to go with it, or the full count
is divided by a shortened window.
*/
func TestTheDrainedTailIsNotCountedAsDelivered(t *testing.T) {
	s := newSession(t)
	start := time.Unix(100, 0)
	feed(s, Down, start, 10*time.Second, 100)

	got := s.Totals(Down)
	if got.Measured >= got.Bytes {
		t.Fatalf("measured %d of %d bytes: the tail was counted", got.Measured, got.Bytes)
	}
	if mbps := got.Mbps(); mbps > 105 {
		t.Fatalf("dropping the tail overstated the rate: %.1f Mbps", mbps)
	}
}

func TestATransferTooShortToSettleReportsNothing(t *testing.T) {
	s := newSession(t)
	feed(s, Down, time.Unix(100, 0), Grace/2, 100)

	if got := s.Totals(Down).Mbps(); got != 0 {
		t.Fatalf("expected no figure from a transfer inside the grace period, got %.1f", got)
	}
}

func TestDirectionsAreCountedApart(t *testing.T) {
	s := newSession(t)
	start := time.Unix(100, 0)
	feed(s, Down, start, 10*time.Second, 100)
	feed(s, Up, start, 10*time.Second, 20)

	down, up := s.Totals(Down).Mbps(), s.Totals(Up).Mbps()
	if down < 90 || up > 30 || up < 10 {
		t.Fatalf("directions bled into each other: down %.1f, up %.1f", down, up)
	}
}

func TestEveryByteIsKeptEvenWhenNotAllAreMeasured(t *testing.T) {
	s := newSession(t)
	feed(s, Down, time.Unix(100, 0), 10*time.Second, 100)

	got := s.Totals(Down)
	if got.Bytes <= 0 {
		t.Fatal("total bytes were not recorded")
	}
	if got.Streams != 0 {
		t.Fatalf("no stream was opened, but %d were counted", got.Streams)
	}
}

func TestStreamsAreCounted(t *testing.T) {
	s := newSession(t)
	now := time.Unix(100, 0)
	for i := 0; i < 6; i++ {
		s.Begin(Down, now)
	}
	if got := s.Totals(Down).Streams; got != 6 {
		t.Fatalf("expected 6 streams, got %d", got)
	}
}

func TestASessionIsOnlyReachableFromTheAddressThatOpenedIt(t *testing.T) {
	store := NewStore(0, 0)
	sess, err := store.Create(addr("10.0.0.1"), "agent", time.Unix(0, 0))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if _, ok := store.Get(sess.ID, addr("10.0.0.2")); ok {
		t.Fatal("another address reached the session")
	}
	if _, ok := store.Get(sess.ID, addr("10.0.0.1")); !ok {
		t.Fatal("the owner could not reach its own session")
	}
}

func TestClosingHandsTheSessionOverExactlyOnce(t *testing.T) {
	store := NewStore(0, 0)
	sess, _ := store.Create(addr("10.0.0.1"), "agent", time.Unix(0, 0))

	if _, ok := store.Close(sess.ID, addr("10.0.0.1")); !ok {
		t.Fatal("close did not return the session")
	}
	if _, ok := store.Close(sess.ID, addr("10.0.0.1")); ok {
		t.Fatal("the session was returned twice")
	}
}

// Sessions are created by unauthenticated requests, so an unbounded map of
// them is a way to exhaust memory from the outside.
func TestTheStoreRefusesToGrowWithoutBound(t *testing.T) {
	store := NewStore(4, time.Minute)
	now := time.Unix(0, 0)
	for i := 0; i < 4; i++ {
		if _, err := store.Create(addr("10.0.0.1"), "agent", now); err != nil {
			t.Fatalf("create %d: %v", i, err)
		}
	}
	if _, err := store.Create(addr("10.0.0.1"), "agent", now); err == nil {
		t.Fatal("the store grew past its limit")
	}
}

func TestAbandonedSessionsAreSweptAway(t *testing.T) {
	store := NewStore(4, time.Minute)
	start := time.Unix(0, 0)
	store.Create(addr("10.0.0.1"), "agent", start)

	store.Sweep(start.Add(2 * time.Minute))
	if store.Len() != 0 {
		t.Fatal("an abandoned session survived the sweep")
	}
}

// A very slow link is not an abandoned one.
func TestASessionStillTransferringIsNotSwept(t *testing.T) {
	store := NewStore(4, time.Minute)
	start := time.Unix(0, 0)
	sess, _ := store.Create(addr("10.0.0.1"), "agent", start)
	sess.Begin(Down, start)

	store.Sweep(start.Add(2 * time.Minute))
	if store.Len() != 1 {
		t.Fatal("a session with a stream still open was swept away")
	}
}

func TestSweepingMakesRoomForNewSessions(t *testing.T) {
	store := NewStore(1, time.Minute)
	start := time.Unix(0, 0)
	store.Create(addr("10.0.0.1"), "agent", start)

	if _, err := store.Create(addr("10.0.0.2"), "agent", start.Add(2*time.Minute)); err != nil {
		t.Fatalf("a stale session blocked a new one: %v", err)
	}
}

func TestIdentifiersAreNotGuessable(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 256; i++ {
		id, err := newID()
		if err != nil {
			t.Fatalf("newID: %v", err)
		}
		if len(id) < 24 {
			t.Fatalf("identifier is too short to be unguessable: %q", id)
		}
		if seen[id] {
			t.Fatalf("identifier repeated: %q", id)
		}
		seen[id] = true
	}
}
