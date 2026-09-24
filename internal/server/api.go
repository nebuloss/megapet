package server

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/nebuloss/megapet/internal/config"
	"github.com/nebuloss/megapet/internal/netutil"
	"github.com/nebuloss/megapet/internal/session"
	"github.com/nebuloss/megapet/internal/share"
	"github.com/nebuloss/megapet/internal/speed"
	"github.com/nebuloss/megapet/internal/store"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// clientConfig is the payload the frontend boots from.
type clientConfig struct {
	Title        string `json:"title"`
	SeedColor    string `json:"seed_color"`
	ShowHistory  bool   `json:"show_history"`
	AutoStart    bool   `json:"auto_start"`
	StoreEnabled bool   `json:"store_enabled"`
	// Empty unless the operator advertised an address that bypasses any proxy.
	DirectURL string        `json:"direct_url"`
	Version   string        `json:"version"`
	Test      config.Test   `json:"test"`
	Servers   []config.Peer `json:"servers"`
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	s.metrics.TestsStarted.Add(1)
	writeJSON(w, http.StatusOK, clientConfig{
		Title:        s.cfg.UI.Title,
		SeedColor:    s.cfg.UI.SeedColor,
		ShowHistory:  s.cfg.UI.ShowHistory && s.db != nil,
		AutoStart:    s.cfg.UI.AutoStart,
		StoreEnabled: s.db != nil,
		DirectURL:    s.cfg.Direct.URL,
		Version:      Version,
		Test:         s.cfg.Test,
		Servers:      s.cfg.Servers,
	})
}

func (s *Server) handleIP(w http.ResponseWriter, r *http.Request) {
	addr := speed.ClientAddr(r)
	writeJSON(w, http.StatusOK, s.ip.Do(r.Context(), addr))
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	status := map[string]any{"status": "ok", "version": Version}
	if s.db != nil {
		if _, err := s.db.Summarize(r.Context(), time.Now().Add(-time.Minute)); err != nil {
			s.log.Error("health check: store unreachable", "error", err)
			writeJSON(w, http.StatusServiceUnavailable,
				map[string]any{"status": "degraded", "error": "store unreachable"})
			return
		}
		status["store"] = "ok"
	}
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	s.metrics.ActiveStreams.Store(int64(s.limiter.Active()))
	s.metrics.Handler().ServeHTTP(w, r)
}

/*
A run is opened before it starts and closed when it finishes.

Nothing about the measurement travels in either request. The client says it is
beginning a test, moves bytes through the measurement endpoints quoting the id
it was given, and then says it has finished; the figures come from what this
server counted while that happened. There is deliberately no way to tell the
server how fast the link was.
*/
type runOpened struct {
	ID string `json:"id"`
}

// What a client may label a run with. Presentation only, never a measurement.
type runClose struct {
	ServerID   string `json:"server_id"`
	ServerName string `json:"server_name"`
	Note       string `json:"note"`
}

func trunc(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (s *Server) handleOpenRun(w http.ResponseWriter, r *http.Request) {
	sess, err := s.runs.Create(speed.ClientAddr(r), trunc(r.UserAgent(), 400), time.Now())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "too many tests in progress")
		return
	}
	writeJSON(w, http.StatusCreated, runOpened{ID: sess.ID})
}

/*
Closes a run and records what the server measured.

A run with nothing worth reporting is not an error and is not stored: a visitor
who starts a test and immediately stops it has produced no measurement, and a
row of zeroes in the history would be indistinguishable from a link that failed.
*/
func (s *Server) handleCloseRun(w http.ResponseWriter, r *http.Request) {
	addr := speed.ClientAddr(r)
	sess, ok := s.runs.Close(r.PathValue("id"), addr)
	if !ok {
		writeError(w, http.StatusNotFound, "no such test")
		return
	}

	var in runClose
	// A body is optional: these are labels, and a run is closed on its own
	// merits whether or not the client had anything to add.
	if r.Body != nil {
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10))
		dec.DisallowUnknownFields()
		_ = dec.Decode(&in)
	}

	down := sess.Totals(session.Down)
	up := sess.Totals(session.Up)
	if down.Mbps() <= 0 && up.Mbps() <= 0 {
		writeJSON(w, http.StatusOK, map[string]any{"stored": false})
		return
	}

	if s.db == nil {
		writeJSON(w, http.StatusOK, map[string]any{"stored": false})
		return
	}

	info := s.ip.Do(r.Context(), addr)
	res := store.Result{
		CreatedAt:     sess.StartedAt,
		DownloadMbps:  down.Mbps(),
		UploadMbps:    up.Mbps(),
		DownloadBytes: down.Bytes,
		UploadBytes:   up.Bytes,
		ISP:           info.ISP,
		ASN:           info.ASN,
		Country:       info.Country,
		City:          info.City,
		UserAgent:     sess.UserAgent,
		ServerID:      trunc(in.ServerID, 64),
		ServerName:    trunc(in.ServerName, 120),
		Note:          trunc(in.Note, 280),
	}
	if s.cfg.Store.RecordIP {
		stored := addr
		if s.cfg.Store.AnonymizeIP {
			stored = netutil.Anonymize(addr)
		}
		res.ClientIP = netutil.String(stored)
	}

	if err := s.db.Save(r.Context(), &res); err != nil {
		s.log.Error("save result", "error", err)
		writeError(w, http.StatusInternalServerError, "could not save result")
		return
	}
	s.metrics.ResultsSaved.Add(1)
	s.log.Info("result measured",
		"id", res.ID,
		"download_mbps", math.Round(res.DownloadMbps*100)/100,
		"upload_mbps", math.Round(res.UploadMbps*100)/100,
		"down_streams", down.Streams,
		"up_streams", up.Streams,
		"client", res.ClientIP)

	writeJSON(w, http.StatusCreated, s.decorate(r, res))
}

// resultView adds share links to a stored result.
type resultView struct {
	store.Result
	URL     string `json:"url"`
	CardURL string `json:"card_url"`
}

func (s *Server) decorate(r *http.Request, res store.Result) resultView {
	base := s.cfg.BaseURL
	if base == "" {
		scheme := "http"
		if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	return resultView{
		Result:  res,
		URL:     base + "/r/" + res.ID,
		CardURL: base + "/api/results/" + res.ID + "/card.svg",
	}
}

func (s *Server) handleGetResult(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeError(w, http.StatusNotImplemented, "result storage is disabled")
		return
	}
	res, err := s.db.Get(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "no such result")
		return
	}
	if err != nil {
		s.log.Error("get result", "error", err)
		writeError(w, http.StatusInternalServerError, "could not read result")
		return
	}
	writeJSON(w, http.StatusOK, s.decorate(r, res))
}

func (s *Server) handleListResults(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusOK, map[string]any{"results": []store.Result{}})
		return
	}
	q := r.URL.Query()
	opt := store.ListOptions{
		Limit:  atoiDefault(q.Get("limit"), 25),
		Offset: atoiDefault(q.Get("offset"), 0),
	}
	if days := atoiDefault(q.Get("days"), 0); days > 0 {
		opt.Since = time.Now().AddDate(0, 0, -days)
	}
	// "mine" restricts the history to the caller's own address, which is what
	// someone checking their own connection almost always wants.
	if q.Get("scope") == "mine" && s.cfg.Store.RecordIP {
		addr := speed.ClientAddr(r)
		if s.cfg.Store.AnonymizeIP {
			addr = netutil.Anonymize(addr)
		}
		opt.ClientIP = netutil.String(addr)
		if opt.ClientIP == "" {
			opt.ClientIP = "\x00no-match"
		}
	}

	results, err := s.db.List(r.Context(), opt)
	if err != nil {
		s.log.Error("list results", "error", err)
		writeError(w, http.StatusInternalServerError, "could not list results")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results, "count": len(results)})
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeJSON(w, http.StatusOK, store.Summary{})
		return
	}
	since := time.Time{}
	if days := atoiDefault(r.URL.Query().Get("days"), 30); days > 0 {
		since = time.Now().AddDate(0, 0, -days)
	}
	sum, err := s.db.Summarize(r.Context(), since)
	if err != nil {
		s.log.Error("summarize", "error", err)
		writeError(w, http.StatusInternalServerError, "could not summarize results")
		return
	}
	writeJSON(w, http.StatusOK, sum)
}

func (s *Server) handleResultCard(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		http.Error(w, "result storage is disabled", http.StatusNotImplemented)
		return
	}
	res, err := s.db.Get(r.Context(), r.PathValue("id"))
	if errors.Is(err, store.ErrNotFound) {
		http.Error(w, "no such result", http.StatusNotFound)
		return
	}
	if err != nil {
		s.log.Error("card lookup", "error", err)
		http.Error(w, "could not read result", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age="+strconv.Itoa(int(share.MaxAge.Seconds())))
	if err := share.Render(w, share.Card{
		Title:  s.cfg.UI.Title,
		Result: res,
		Accent: s.cfg.UI.SeedColor,
	}); err != nil {
		s.log.Error("render card", "error", err)
	}
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	return n
}
