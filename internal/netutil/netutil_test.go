package netutil

import (
	"net/http"
	"net/netip"
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
