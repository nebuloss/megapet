// Package store persists test results in a single SQLite file.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// ErrNotFound is returned when a result id does not exist.
var ErrNotFound = errors.New("result not found")

// Result is one completed speedtest.
type Result struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`

	DownloadMbps float64 `json:"download_mbps"`
	UploadMbps   float64 `json:"upload_mbps"`
	PingMs       float64 `json:"ping_ms"`
	JitterMs     float64 `json:"jitter_ms"`
	PingMinMs    float64 `json:"ping_min_ms"`
	PingMaxMs    float64 `json:"ping_max_ms"`

	DownloadBytes int64 `json:"download_bytes"`
	UploadBytes   int64 `json:"upload_bytes"`

	ClientIP string `json:"client_ip,omitempty"`
	ISP      string `json:"isp,omitempty"`
	ASN      string `json:"asn,omitempty"`
	Country  string `json:"country,omitempty"`
	City     string `json:"city,omitempty"`

	UserAgent  string `json:"-"`
	Platform   string `json:"platform,omitempty"`
	ServerID   string `json:"server_id,omitempty"`
	ServerName string `json:"server_name,omitempty"`
	Note       string `json:"note,omitempty"`
}

// Summary aggregates a window of results for the dashboard.
type Summary struct {
	Count           int     `json:"count"`
	Since           string  `json:"since,omitempty"`
	AvgDownloadMbps float64 `json:"avg_download_mbps"`
	AvgUploadMbps   float64 `json:"avg_upload_mbps"`
	AvgPingMs       float64 `json:"avg_ping_ms"`
	MaxDownloadMbps float64 `json:"max_download_mbps"`
	MaxUploadMbps   float64 `json:"max_upload_mbps"`
	MinPingMs       float64 `json:"min_ping_ms"`
}

// DB wraps the SQLite handle.
type DB struct{ sql *sql.DB }

const schema = `
CREATE TABLE IF NOT EXISTS results (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  download_mbps  REAL    NOT NULL DEFAULT 0,
  upload_mbps    REAL    NOT NULL DEFAULT 0,
  ping_ms        REAL    NOT NULL DEFAULT 0,
  jitter_ms      REAL    NOT NULL DEFAULT 0,
  ping_min_ms    REAL    NOT NULL DEFAULT 0,
  ping_max_ms    REAL    NOT NULL DEFAULT 0,
  download_bytes INTEGER NOT NULL DEFAULT 0,
  upload_bytes   INTEGER NOT NULL DEFAULT 0,
  client_ip      TEXT    NOT NULL DEFAULT '',
  isp            TEXT    NOT NULL DEFAULT '',
  asn            TEXT    NOT NULL DEFAULT '',
  country        TEXT    NOT NULL DEFAULT '',
  city           TEXT    NOT NULL DEFAULT '',
  user_agent     TEXT    NOT NULL DEFAULT '',
  platform       TEXT    NOT NULL DEFAULT '',
  server_id      TEXT    NOT NULL DEFAULT '',
  server_name    TEXT    NOT NULL DEFAULT '',
  note           TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS results_created_at_idx ON results (created_at DESC);
`

// Open opens (creating if needed) the SQLite database at path.
func Open(ctx context.Context, path string) (*DB, error) {
	dsn := path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(ON)"
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// SQLite serialises writes; a small pool avoids lock contention while still
	// allowing concurrent reads under WAL.
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(8)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := sqlDB.PingContext(ctx); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	if _, err := sqlDB.ExecContext(ctx, schema); err != nil {
		sqlDB.Close()
		return nil, fmt.Errorf("migrate %s: %w", path, err)
	}
	return &DB{sql: sqlDB}, nil
}

// Close releases the database handle.
func (d *DB) Close() error { return d.sql.Close() }

// NewID returns a short, URL-safe, unguessable result identifier.
func NewID() string {
	// Crockford base32 without I, L, O, U to stay unambiguous when read aloud.
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
	var b [10]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("store: crypto/rand failed: " + err.Error())
	}
	var sb strings.Builder
	sb.Grow(len(b))
	for _, v := range b {
		sb.WriteByte(alphabet[int(v)%len(alphabet)])
	}
	return sb.String()
}

// Save writes r, assigning an id and timestamp when they are unset.
func (d *DB) Save(ctx context.Context, r *Result) error {
	if r.ID == "" {
		r.ID = NewID()
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now()
	}
	_, err := d.sql.ExecContext(ctx, `
		INSERT INTO results (
			id, created_at, download_mbps, upload_mbps, ping_ms, jitter_ms,
			ping_min_ms, ping_max_ms, download_bytes, upload_bytes,
			client_ip, isp, asn, country, city, user_agent, platform,
			server_id, server_name, note
		) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.CreatedAt.UnixMilli(), r.DownloadMbps, r.UploadMbps, r.PingMs, r.JitterMs,
		r.PingMinMs, r.PingMaxMs, r.DownloadBytes, r.UploadBytes,
		r.ClientIP, r.ISP, r.ASN, r.Country, r.City, r.UserAgent, r.Platform,
		r.ServerID, r.ServerName, r.Note)
	return err
}

const selectColumns = `
	id, created_at, download_mbps, upload_mbps, ping_ms, jitter_ms,
	ping_min_ms, ping_max_ms, download_bytes, upload_bytes,
	client_ip, isp, asn, country, city, user_agent, platform,
	server_id, server_name, note`

func scanResult(sc interface{ Scan(...any) error }) (Result, error) {
	var r Result
	var ms int64
	err := sc.Scan(&r.ID, &ms, &r.DownloadMbps, &r.UploadMbps, &r.PingMs, &r.JitterMs,
		&r.PingMinMs, &r.PingMaxMs, &r.DownloadBytes, &r.UploadBytes,
		&r.ClientIP, &r.ISP, &r.ASN, &r.Country, &r.City, &r.UserAgent, &r.Platform,
		&r.ServerID, &r.ServerName, &r.Note)
	if err != nil {
		return Result{}, err
	}
	r.CreatedAt = time.UnixMilli(ms).UTC()
	return r, nil
}

// Get returns a single result by id.
func (d *DB) Get(ctx context.Context, id string) (Result, error) {
	row := d.sql.QueryRowContext(ctx, `SELECT `+selectColumns+` FROM results WHERE id = ?`, id)
	r, err := scanResult(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Result{}, ErrNotFound
	}
	return r, err
}

// ListOptions filters a history query.
type ListOptions struct {
	Limit    int
	Offset   int
	Since    time.Time
	ClientIP string
}

// List returns results newest first.
func (d *DB) List(ctx context.Context, opt ListOptions) ([]Result, error) {
	if opt.Limit <= 0 || opt.Limit > 500 {
		opt.Limit = 50
	}
	where := []string{"1=1"}
	args := []any{}
	if !opt.Since.IsZero() {
		where = append(where, "created_at >= ?")
		args = append(args, opt.Since.UnixMilli())
	}
	if opt.ClientIP != "" {
		where = append(where, "client_ip = ?")
		args = append(args, opt.ClientIP)
	}
	args = append(args, opt.Limit, opt.Offset)

	q := `SELECT ` + selectColumns + ` FROM results WHERE ` + strings.Join(where, " AND ") +
		` ORDER BY created_at DESC LIMIT ? OFFSET ?`
	rows, err := d.sql.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]Result, 0, opt.Limit)
	for rows.Next() {
		r, err := scanResult(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Summarize aggregates results recorded at or after since.
func (d *DB) Summarize(ctx context.Context, since time.Time) (Summary, error) {
	var s Summary
	var (
		avgD, avgU, avgP sql.NullFloat64
		maxD, maxU, minP sql.NullFloat64
	)
	row := d.sql.QueryRowContext(ctx, `
		SELECT COUNT(*),
		       AVG(download_mbps), AVG(upload_mbps), AVG(ping_ms),
		       MAX(download_mbps), MAX(upload_mbps), MIN(NULLIF(ping_ms, 0))
		FROM results WHERE created_at >= ?`, since.UnixMilli())
	if err := row.Scan(&s.Count, &avgD, &avgU, &avgP, &maxD, &maxU, &minP); err != nil {
		return Summary{}, err
	}
	s.AvgDownloadMbps = avgD.Float64
	s.AvgUploadMbps = avgU.Float64
	s.AvgPingMs = avgP.Float64
	s.MaxDownloadMbps = maxD.Float64
	s.MaxUploadMbps = maxU.Float64
	s.MinPingMs = minP.Float64
	if !since.IsZero() {
		s.Since = since.UTC().Format(time.RFC3339)
	}
	return s, nil
}

// Prune deletes results older than the cutoff and returns how many were removed.
func (d *DB) Prune(ctx context.Context, cutoff time.Time) (int64, error) {
	res, err := d.sql.ExecContext(ctx, `DELETE FROM results WHERE created_at < ?`, cutoff.UnixMilli())
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
