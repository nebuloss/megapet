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

// submission is the client-reported outcome of a test run.
type submission struct {
	DownloadMbps  float64 `json:"download_mbps"`
	UploadMbps    float64 `json:"upload_mbps"`
	PingMs        float64 `json:"ping_ms"`
	JitterMs      float64 `json:"jitter_ms"`
	PingMinMs     float64 `json:"ping_min_ms"`
	PingMaxMs     float64 `json:"ping_max_ms"`
	DownloadBytes int64   `json:"download_bytes"`
	UploadBytes   int64   `json:"upload_bytes"`
	Platform      string  `json:"platform"`
	ServerID      string  `json:"server_id"`
	ServerName    string  `json:"server_name"`
	Note          string  `json:"note"`
}

// sane clamps a client-reported number into a believable range. The browser is
// the only thing that can measure the link, so the values cannot be verified —
// but they can be kept from poisoning the history with NaN or absurd figures.
func sane(v, max float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	return math.Min(v, max)
}

func clampBytes(v, max int64) int64 {
	if v < 0 {
		return 0
	}
	return min(v, max)
}

func trunc(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func (s *Server) handleSaveResult(w http.ResponseWriter, r *http.Request) {
	if s.db == nil {
		writeError(w, http.StatusNotImplemented, "result storage is disabled")
		return
	}

	var in submission
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}

	addr := speed.ClientAddr(r)
	info := s.ip.Do(r.Context(), addr)

	res := store.Result{
		DownloadMbps:  sane(in.DownloadMbps, 1e6),
		UploadMbps:    sane(in.UploadMbps, 1e6),
		PingMs:        sane(in.PingMs, 60_000),
		JitterMs:      sane(in.JitterMs, 60_000),
		PingMinMs:     sane(in.PingMinMs, 60_000),
		PingMaxMs:     sane(in.PingMaxMs, 60_000),
		DownloadBytes: clampBytes(in.DownloadBytes, 1<<50),
		UploadBytes:   clampBytes(in.UploadBytes, 1<<50),
		ISP:           info.ISP,
		ASN:           info.ASN,
		Country:       info.Country,
		City:          info.City,
		UserAgent:     trunc(r.UserAgent(), 400),
		Platform:      trunc(in.Platform, 120),
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
	s.log.Info("result saved",
		"id", res.ID,
		"download_mbps", math.Round(res.DownloadMbps*100)/100,
		"upload_mbps", math.Round(res.UploadMbps*100)/100,
		"ping_ms", math.Round(res.PingMs*100)/100,
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
