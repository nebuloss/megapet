package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func open(t *testing.T) *DB {
	t.Helper()
	db, err := Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func TestSaveAndGet(t *testing.T) {
	ctx := context.Background()
	db := open(t)

	in := Result{
		DownloadMbps: 942.31, UploadMbps: 918.4,
		PingMs: 0.42, JitterMs: 0.08, PingMinMs: 0.39, PingMaxMs: 0.91,
		DownloadBytes: 1_178_000_000, UploadBytes: 1_148_000_000,
		ClientIP: "10.0.50.20", ISP: "Private network", ServerName: "This server",
	}
	if err := db.Save(ctx, &in); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if len(in.ID) != 10 {
		t.Errorf("Save assigned id %q, want 10 characters", in.ID)
	}
	if in.CreatedAt.IsZero() {
		t.Error("Save did not stamp CreatedAt")
	}

	got, err := db.Get(ctx, in.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.DownloadMbps != in.DownloadMbps || got.ClientIP != in.ClientIP {
		t.Errorf("Get returned %+v, want the saved row", got)
	}
	// Timestamps round-trip at millisecond resolution.
	if d := got.CreatedAt.Sub(in.CreatedAt); d > time.Millisecond || d < -time.Millisecond {
		t.Errorf("CreatedAt drifted by %v", d)
	}
}

func TestGetMissing(t *testing.T) {
	if _, err := open(t).Get(context.Background(), "NOPENOPE00"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get(missing) = %v, want ErrNotFound", err)
	}
}

func TestListOrderAndFilters(t *testing.T) {
	ctx := context.Background()
	db := open(t)
	now := time.Now()

	rows := []Result{
		{DownloadMbps: 1, ClientIP: "10.0.0.1", CreatedAt: now.Add(-72 * time.Hour)},
		{DownloadMbps: 2, ClientIP: "10.0.0.2", CreatedAt: now.Add(-2 * time.Hour)},
		{DownloadMbps: 3, ClientIP: "10.0.0.1", CreatedAt: now.Add(-1 * time.Hour)},
	}
	for i := range rows {
		if err := db.Save(ctx, &rows[i]); err != nil {
			t.Fatal(err)
		}
	}

	all, err := db.List(ctx, ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("List returned %d rows, want 3", len(all))
	}
	if all[0].DownloadMbps != 3 || all[2].DownloadMbps != 1 {
		t.Errorf("List is not newest-first: %v", []float64{all[0].DownloadMbps, all[2].DownloadMbps})
	}

	recent, err := db.List(ctx, ListOptions{Since: now.Add(-24 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 2 {
		t.Errorf("Since filter returned %d rows, want 2", len(recent))
	}

	mine, err := db.List(ctx, ListOptions{ClientIP: "10.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 2 {
		t.Errorf("ClientIP filter returned %d rows, want 2", len(mine))
	}

	page, err := db.List(ctx, ListOptions{Limit: 1, Offset: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 1 || page[0].DownloadMbps != 2 {
		t.Errorf("paged List returned %+v, want the second-newest row", page)
	}
}

func TestSummarize(t *testing.T) {
	ctx := context.Background()
	db := open(t)
	now := time.Now()

	rows := []Result{
		{DownloadMbps: 100, UploadMbps: 50, PingMs: 10, CreatedAt: now.Add(-time.Hour)},
		{DownloadMbps: 300, UploadMbps: 150, PingMs: 4, CreatedAt: now.Add(-2 * time.Hour)},
		// Older than the window, so it must not affect the aggregates.
		{DownloadMbps: 9000, UploadMbps: 9000, PingMs: 1, CreatedAt: now.Add(-90 * 24 * time.Hour)},
	}
	for i := range rows {
		if err := db.Save(ctx, &rows[i]); err != nil {
			t.Fatal(err)
		}
	}

	sum, err := db.Summarize(ctx, now.AddDate(0, 0, -30))
	if err != nil {
		t.Fatal(err)
	}
	if sum.Count != 2 {
		t.Fatalf("Count = %d, want 2", sum.Count)
	}
	if sum.AvgDownloadMbps != 200 {
		t.Errorf("AvgDownloadMbps = %v, want 200", sum.AvgDownloadMbps)
	}
	if sum.MaxDownloadMbps != 300 {
		t.Errorf("MaxDownloadMbps = %v, want 300", sum.MaxDownloadMbps)
	}
	if sum.MinPingMs != 4 {
		t.Errorf("MinPingMs = %v, want 4", sum.MinPingMs)
	}
}

// A ping of exactly zero means "not measured", so it must not win MIN().
func TestSummarizeIgnoresZeroPing(t *testing.T) {
	ctx := context.Background()
	db := open(t)
	for _, r := range []Result{{PingMs: 0}, {PingMs: 12}} {
		row := r
		if err := db.Save(ctx, &row); err != nil {
			t.Fatal(err)
		}
	}
	sum, err := db.Summarize(ctx, time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if sum.MinPingMs != 12 {
		t.Errorf("MinPingMs = %v, want 12", sum.MinPingMs)
	}
}

func TestPrune(t *testing.T) {
	ctx := context.Background()
	db := open(t)
	now := time.Now()

	for _, age := range []time.Duration{time.Hour, 40 * 24 * time.Hour, 60 * 24 * time.Hour} {
		row := Result{CreatedAt: now.Add(-age)}
		if err := db.Save(ctx, &row); err != nil {
			t.Fatal(err)
		}
	}

	n, err := db.Prune(ctx, now.AddDate(0, 0, -30))
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("Prune removed %d rows, want 2", n)
	}
	left, err := db.List(ctx, ListOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 1 {
		t.Errorf("%d rows left, want 1", len(left))
	}
}

func TestNewIDIsUnique(t *testing.T) {
	seen := make(map[string]bool, 2000)
	for i := 0; i < 2000; i++ {
		id := NewID()
		if seen[id] {
			t.Fatalf("NewID produced a duplicate after %d draws: %s", i, id)
		}
		seen[id] = true
	}
}
