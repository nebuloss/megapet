// Package certs serves a TLS certificate that can be replaced on disk while
// the server is running.
package certs

import (
	"crypto/tls"
	"fmt"
	"os"
	"sync"
	"time"
)

// How often the files are stat'd at most. Handshakes can arrive in bursts and
// the certificate changes a few times a year, so re-checking on every one is
// pointless; a second of staleness after a renewal is harmless.
const checkInterval = time.Second

// Reloader hands out a certificate, re-reading it when the files change.
//
// This exists because certificates are usually renewed by something else —
// certbot, Caddy, Nginx Proxy Manager — which rewrites the files underneath a
// running process. A server that reads them once at startup keeps serving the
// old certificate until someone restarts it, which is to say until it expires
// and someone notices.
type Reloader struct {
	certFile string
	keyFile  string

	mu       sync.RWMutex
	current  *tls.Certificate
	modified time.Time
	checked  time.Time
}

// New reads the pair once, so a bad path or an unreadable key fails at startup
// rather than at the first handshake.
func New(certFile, keyFile string) (*Reloader, error) {
	r := &Reloader{certFile: certFile, keyFile: keyFile}
	if err := r.reload(); err != nil {
		return nil, err
	}
	return r, nil
}

// TLSConfig returns a config that consults the reloader on every handshake.
func (r *Reloader) TLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: r.getCertificate,
		MinVersion:     tls.VersionTLS12,
	}
}

func (r *Reloader) getCertificate(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	if r.stale() {
		// A failed reload is not fatal: the previous certificate is still
		// valid until it expires, and refusing every connection because a
		// renewal wrote a half-finished file would be worse.
		_ = r.reload()
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.current, nil
}

// stale reports whether the files should be re-examined.
func (r *Reloader) stale() bool {
	r.mu.RLock()
	checked, modified := r.checked, r.modified
	r.mu.RUnlock()

	if time.Since(checked) < checkInterval {
		return false
	}
	info, err := os.Stat(r.certFile)
	if err != nil {
		return false
	}
	return info.ModTime().After(modified)
}

func (r *Reloader) reload() error {
	pair, err := tls.LoadX509KeyPair(r.certFile, r.keyFile)
	if err != nil {
		return fmt.Errorf("certs: loading %s: %w", r.certFile, err)
	}
	info, err := os.Stat(r.certFile)
	if err != nil {
		return fmt.Errorf("certs: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.current = &pair
	r.modified = info.ModTime()
	r.checked = time.Now()
	return nil
}
