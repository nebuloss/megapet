package netutil

import (
	"net/http"
	"net/netip"
	"strings"
	"testing"
)

func request(remote string, headers map[string][]string) *http.Request {
	r := &http.Request{RemoteAddr: remote, Header: http.Header{}}
	for k, vs := range headers {
		for _, v := range vs {
			r.Header.Add(k, v)
		}
	}
	return r
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name    string
		trusted []string
		remote  string
		headers map[string][]string
		want    string
	}{
		{
			name:   "no proxy configured uses the socket peer",
			remote: "203.0.113.7:5555",
			want:   "203.0.113.7",
		},
		{
			name:    "forwarding header ignored from an untrusted peer",
			trusted: []string{"10.0.0.0/8"},
			remote:  "203.0.113.7:5555",
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9"}},
			want:    "203.0.113.7",
		},
		{
			name:    "trusted peer forwarding a single client",
			trusted: []string{"10.0.0.0/8"},
			remote:  "10.9.9.1:5555",
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "chain of trusted proxies resolves to the closest untrusted hop",
			trusted: []string{"10.0.0.0/8"},
			remote:  "10.9.9.1:5555",
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9, 10.9.9.9, 10.9.9.1"}},
			want:    "198.51.100.9",
		},
		{
			name:    "spoofed leading entry cannot outrank the real hop",
			trusted: []string{"10.0.0.0/8"},
			remote:  "10.9.9.1:5555",
			headers: map[string][]string{"X-Forwarded-For": {"1.2.3.4, 198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "x-real-ip used when no forwarded-for is present",
			trusted: []string{"10.0.0.0/8"},
			remote:  "10.9.9.1:5555",
			headers: map[string][]string{"X-Real-IP": {"198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "bare trusted address is treated as a single host",
			trusted: []string{"10.9.9.1"},
			remote:  "10.9.9.1:5555",
			headers: map[string][]string{"X-Forwarded-For": {"198.51.100.9"}},
			want:    "198.51.100.9",
		},
		{
			name:    "ipv6 forwarded entry with a port",
			trusted: []string{"::1/128"},
			remote:  "[::1]:5555",
			headers: map[string][]string{"X-Forwarded-For": {"[2001:db8::5]:443"}},
			want:    "2001:db8::5",
		},
		{
			name:   "ipv4-mapped peer is unmapped",
			remote: "[::ffff:203.0.113.7]:5555",
			want:   "203.0.113.7",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r, err := NewResolver(tc.trusted)
			if err != nil {
				t.Fatalf("NewResolver(%v) = %v", tc.trusted, err)
			}
			if got := String(r.ClientIP(request(tc.remote, tc.headers))); got != tc.want {
				t.Errorf("ClientIP() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNewResolverRejectsGarbage(t *testing.T) {
	if _, err := NewResolver([]string{"not-an-address"}); err == nil {
		t.Fatal("NewResolver accepted an invalid CIDR")
	}
}

func TestAnonymize(t *testing.T) {
	tests := []struct{ in, want string }{
		{"203.0.113.7", "203.0.113.0"},
		{"10.9.9.20", "10.9.9.0"},
		{"2001:db8:1:2:3:4:5:6", "2001:db8:1::"},
	}
	for _, tc := range tests {
		got := Anonymize(netip.MustParseAddr(tc.in))
		if got.String() != tc.want {
			t.Errorf("Anonymize(%s) = %s, want %s", tc.in, got, tc.want)
		}
	}
}

func TestIsPrivate(t *testing.T) {
	private := []string{"10.9.9.20", "192.168.1.1", "172.16.0.1", "127.0.0.1", "fd00::1", "::1"}
	public := []string{"203.0.113.7", "8.8.8.8", "2001:db8::1"}

	for _, s := range private {
		if !IsPrivate(netip.MustParseAddr(s)) {
			t.Errorf("IsPrivate(%s) = false, want true", s)
		}
	}
	for _, s := range public {
		if IsPrivate(netip.MustParseAddr(s)) {
			t.Errorf("IsPrivate(%s) = true, want false", s)
		}
	}
}

func TestDirectURL(t *testing.T) {
	tests := []struct {
		name   string
		listen string
		want   string
		ok     bool
	}{
		{"explicit address is used as-is", "192.0.2.10:8080", "http://192.0.2.10:8080", true},
		{"hostname is used as-is", "megapet.example:9000", "http://megapet.example:9000", true},
		{"ipv6 is bracketed", "[2001:db8::1]:8080", "http://[2001:db8::1]:8080", true},
		// Advertising a loopback address would send every client to itself.
		{"loopback is refused", "127.0.0.1:8080", "", false},
		{"ipv6 loopback is refused", "[::1]:8080", "", false},
		{"no port", "192.0.2.10", "", false},
		{"empty", "", "", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := DirectURL(tc.listen, false)
			if ok != tc.ok {
				t.Fatalf("DirectURL(%q) ok = %v, want %v", tc.listen, ok, tc.ok)
			}
			if ok && got != tc.want {
				t.Errorf("DirectURL(%q) = %q, want %q", tc.listen, got, tc.want)
			}
		})
	}
}

func TestDirectURLUsesHTTPSWhenTheServerTerminatesTLS(t *testing.T) {
	// An https page cannot fetch an http origin, so the scheme has to follow
	// whether the server itself is serving TLS.
	got, ok := DirectURL("192.0.2.10:8443", true)
	if !ok || got != "https://192.0.2.10:8443" {
		t.Errorf("DirectURL(secure) = %q, %v; want https://192.0.2.10:8443", got, ok)
	}
}

func TestDirectURLFillsInAWildcardListener(t *testing.T) {
	// A wildcard listener has no usable host, so the primary interface address
	// stands in. Whether one exists depends on the machine, so assert the shape
	// rather than a value.
	for _, listen := range []string{":8080", "0.0.0.0:8080", "[::]:8080"} {
		got, ok := DirectURL(listen, false)
		if !ok {
			t.Skipf("no routable address on this host, so %q cannot be resolved", listen)
		}
		if !strings.HasPrefix(got, "http://") || !strings.HasSuffix(got, ":8080") {
			t.Errorf("DirectURL(%q) = %q, want an http URL on port 8080", listen, got)
		}
		if strings.Contains(got, "127.0.0.1") || strings.Contains(got, "[::1]") {
			t.Errorf("DirectURL(%q) = %q, which is loopback", listen, got)
		}
	}
}

func TestPrimaryAddressIsRoutable(t *testing.T) {
	addr, ok := PrimaryAddress()
	if !ok {
		t.Skip("no routable address on this host")
	}
	if addr.IsLoopback() || addr.IsLinkLocalUnicast() || !addr.IsGlobalUnicast() {
		t.Errorf("PrimaryAddress() = %s, which is not routable", addr)
	}
}
