package certs

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// write generates a self-signed certificate for `name` into dir.
func write(t *testing.T, dir, name string) (certFile, keyFile string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		DNSNames:     []string{name},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}

	certFile = filepath.Join(dir, "cert.pem")
	keyFile = filepath.Join(dir, "key.pem")
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(certFile, certPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyFile, keyPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	return certFile, keyFile
}

func commonName(t *testing.T, r *Reloader) string {
	t.Helper()
	pair, err := r.getCertificate(nil)
	if err != nil {
		t.Fatal(err)
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	return leaf.Subject.CommonName
}

func TestServesTheCertificateOnDisk(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := write(t, dir, "first.example")

	r, err := New(certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	if got := commonName(t, r); got != "first.example" {
		t.Errorf("common name = %q, want first.example", got)
	}
}

func TestPicksUpARenewal(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := write(t, dir, "first.example")

	r, err := New(certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}

	// Renewal: something else rewrites the files under the running server.
	write(t, dir, "renewed.example")
	// The stat is throttled, so age the record rather than sleeping.
	r.mu.Lock()
	r.checked = time.Now().Add(-time.Minute)
	r.modified = time.Time{}
	r.mu.Unlock()

	if got := commonName(t, r); got != "renewed.example" {
		t.Errorf("common name after renewal = %q, want renewed.example", got)
	}
}

func TestKeepsServingWhenAReloadFails(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := write(t, dir, "first.example")

	r, err := New(certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}

	// A renewal caught mid-write: the file exists but is not a certificate.
	if err := os.WriteFile(certFile, []byte("-----BEGIN CERTIFICATE-----\ntruncated"), 0o600); err != nil {
		t.Fatal(err)
	}
	r.mu.Lock()
	r.checked = time.Now().Add(-time.Minute)
	r.modified = time.Time{}
	r.mu.Unlock()

	// Refusing every connection would be worse than serving the old one.
	if got := commonName(t, r); got != "first.example" {
		t.Errorf("common name = %q, want the previous certificate to survive", got)
	}
}

func TestRejectsAMissingPairAtStartup(t *testing.T) {
	if _, err := New("/nonexistent/cert.pem", "/nonexistent/key.pem"); err == nil {
		t.Fatal("New accepted a missing certificate")
	}
}

func TestTLSConfigConsultsTheReloader(t *testing.T) {
	dir := t.TempDir()
	certFile, keyFile := write(t, dir, "first.example")
	r, err := New(certFile, keyFile)
	if err != nil {
		t.Fatal(err)
	}
	cfg := r.TLSConfig()
	if cfg.GetCertificate == nil {
		t.Fatal("TLSConfig did not wire GetCertificate")
	}
	if cfg.MinVersion < tlsVersion12 {
		t.Errorf("MinVersion = %d, want at least TLS 1.2", cfg.MinVersion)
	}
}

const tlsVersion12 = 0x0303
