package server

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// webdist holds the built frontend. `make web` populates it; the placeholder
// keeps the embed directive valid in a source-only checkout.
//
//go:embed all:webdist
var webdist embed.FS

const notBuiltPage = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Frontend not built</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;display:grid;place-items:center;
min-height:100vh;background:#12131a;color:#e5e1e9}main{max-width:44rem;padding:2rem}
code{background:#22242e;padding:.15em .4em;border-radius:.3em}</style>
<main><h1>Frontend not built</h1>
<p>The API is running, but no compiled frontend is embedded in this binary.</p>
<p>Build it with <code>make build</code>, or run the Vite dev server with
<code>make dev</code> and open it on port 5173.</p></main>`

// staticHandler serves the embedded SPA, falling back to index.html so client
// side routes such as /r/{id} resolve on a hard refresh.
func (s *Server) staticHandler() http.Handler {
	root, err := fs.Sub(webdist, "webdist")
	if err != nil {
		s.log.Error("embedded frontend unreadable", "error", err)
		return http.HandlerFunc(notBuilt)
	}
	index, err := fs.ReadFile(root, "index.html")
	if err != nil {
		s.log.Warn("no embedded frontend; serving API only")
		return http.HandlerFunc(notBuilt)
	}
	files := http.FileServerFS(root)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if clean == "." || clean == "" {
			clean = "index.html"
		}

		if st, err := fs.Stat(root, clean); err == nil && !st.IsDir() {
			// Vite fingerprints everything under /assets/, so those are safe to
			// cache forever; the entry document never is.
			if strings.HasPrefix(clean, "assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			files.ServeHTTP(w, r)
			return
		}

		// Unknown path: a missing asset is a 404, anything else is a SPA route.
		if strings.Contains(path.Base(clean), ".") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(index)
	})
}

func notBuilt(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && strings.Contains(path.Base(r.URL.Path), ".") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(notBuiltPage))
}
