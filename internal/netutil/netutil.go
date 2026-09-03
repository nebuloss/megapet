// Package netutil resolves the real client address behind optional proxies.
package netutil

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Resolver extracts the client IP from a request, honouring forwarding headers
// only when the immediate peer is a configured trusted proxy.
type Resolver struct {
	trusted []netip.Prefix
}

// NewResolver compiles the trusted proxy CIDR list. A bare IP is accepted and
// treated as a /32 or /128.
func NewResolver(cidrs []string) (*Resolver, error) {
	r := &Resolver{}
	for _, c := range cidrs {
		if p, err := netip.ParsePrefix(c); err == nil {
			r.trusted = append(r.trusted, p)
			continue
		}
		addr, err := netip.ParseAddr(c)
		if err != nil {
			return nil, err
		}
		r.trusted = append(r.trusted, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return r, nil
}

// ClientIP returns the best-known client address for req.
func (r *Resolver) ClientIP(req *http.Request) netip.Addr {
	peer := parseHostPort(req.RemoteAddr)
	if !peer.IsValid() || !r.isTrusted(peer) {
		return peer
	}

	// Walk X-Forwarded-For right to left and return the first address that is
	// not itself a trusted proxy; that is the closest untrusted hop.
	hops := forwardedFor(req)
	for i := len(hops) - 1; i >= 0; i-- {
		if !r.isTrusted(hops[i]) {
			return hops[i]
		}
	}
	if xr := strings.TrimSpace(req.Header.Get("X-Real-IP")); xr != "" {
		if a, err := netip.ParseAddr(xr); err == nil {
			return a.Unmap()
		}
	}
	if len(hops) > 0 {
		return hops[0]
	}
	return peer
}

func (r *Resolver) isTrusted(a netip.Addr) bool {
	if !a.IsValid() {
		return false
	}
	for _, p := range r.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

func forwardedFor(req *http.Request) []netip.Addr {
	var out []netip.Addr
	for _, h := range req.Header.Values("X-Forwarded-For") {
		for _, part := range strings.Split(h, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			// Some proxies include a port, others bracket IPv6.
			if a := parseHostPort(part); a.IsValid() {
				out = append(out, a)
				continue
			}
			if a, err := netip.ParseAddr(strings.Trim(part, "[]")); err == nil {
				out = append(out, a.Unmap())
			}
		}
	}
	return out
}

func parseHostPort(s string) netip.Addr {
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return ap.Addr().Unmap()
	}
	if host, _, err := net.SplitHostPort(s); err == nil {
		if a, err := netip.ParseAddr(host); err == nil {
			return a.Unmap()
		}
	}
	if a, err := netip.ParseAddr(s); err == nil {
		return a.Unmap()
	}
	return netip.Addr{}
}

// IsPrivate reports whether a is a loopback, link-local, ULA or RFC1918 address.
func IsPrivate(a netip.Addr) bool {
	return a.IsValid() && (a.IsLoopback() || a.IsPrivate() ||
		a.IsLinkLocalUnicast() || a.IsLinkLocalMulticast() || a.IsUnspecified())
}

// Anonymize masks the host portion of an address: the last octet of an IPv4
// address, and everything below the /48 of an IPv6 address.
func Anonymize(a netip.Addr) netip.Addr {
	if !a.IsValid() {
		return a
	}
	if a.Is4() {
		b := a.As4()
		b[3] = 0
		return netip.AddrFrom4(b)
	}
	b := a.As16()
	for i := 6; i < 16; i++ {
		b[i] = 0
	}
	return netip.AddrFrom16(b)
}

// String renders an address for display, returning "" when invalid.
func String(a netip.Addr) string {
	if !a.IsValid() {
		return ""
	}
	return a.String()
}
