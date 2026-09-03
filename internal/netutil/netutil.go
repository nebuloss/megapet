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

// PrimaryAddress returns this host's first routable unicast address, preferring
// IPv4 because that is what a mixed LAN is most likely to reach.
//
// "Routable" here means not loopback and not link-local; it is a guess, and on
// a multi-homed host it may guess wrong, which is why anything using it must
// allow the address to be configured explicitly instead.
func PrimaryAddress() (netip.Addr, bool) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return netip.Addr{}, false
	}

	var fallback netip.Addr
	for _, a := range addrs {
		prefix, ok := a.(*net.IPNet)
		if !ok {
			continue
		}
		addr, ok := netip.AddrFromSlice(prefix.IP)
		if !ok {
			continue
		}
		addr = addr.Unmap()
		if !addr.IsGlobalUnicast() || addr.IsLoopback() || addr.IsLinkLocalUnicast() {
			continue
		}
		if addr.Is4() {
			return addr, true
		}
		if !fallback.IsValid() {
			fallback = addr
		}
	}
	return fallback, fallback.IsValid()
}

// DirectURL derives a URL that reaches this server without passing through a
// reverse proxy, given the address it listens on.
//
// A wildcard listener carries no usable host, so the primary interface address
// stands in for it.
//
// The scheme matters more than it looks: a page served over https cannot fetch
// an http origin, so a direct address is only usable from an https page if the
// server terminates TLS itself. Pass secure accordingly.
func DirectURL(listen string, secure bool) (string, bool) {
	host, port, err := net.SplitHostPort(listen)
	if err != nil || port == "" {
		return "", false
	}

	if host != "" && host != "0.0.0.0" && host != "::" && host != "[::]" {
		if addr, err := netip.ParseAddr(host); err == nil {
			if addr.IsUnspecified() {
				host = ""
			} else if addr.IsLoopback() {
				// Reachable only from the server itself, so useless to advertise.
				return "", false
			}
		}
	} else {
		host = ""
	}

	if host == "" {
		addr, ok := PrimaryAddress()
		if !ok {
			return "", false
		}
		host = addr.String()
	}
	scheme := "http://"
	if secure {
		scheme = "https://"
	}
	return scheme + net.JoinHostPort(host, port), true
}
