// Package ipinfo resolves a client address to an ISP/ASN label.
//
// Outbound lookups are opt-in: on an internal network the useful answer is
// almost always "private address", which is determined locally at no cost.
package ipinfo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/nebuloss/speedtest/internal/netutil"
)

// Info describes the network a client is connecting from.
type Info struct {
	IP      string `json:"ip,omitempty"`
	ISP     string `json:"isp,omitempty"`
	ASN     string `json:"asn,omitempty"`
	Country string `json:"country,omitempty"`
	City    string `json:"city,omitempty"`
	Private bool   `json:"private"`
}

// Options configures a Lookup.
type Options struct {
	Enabled  bool
	Provider string
	Token    string
	Timeout  time.Duration
	CacheTTL time.Duration

	// OnLookup and OnFailure let the caller wire in counters.
	OnLookup  func()
	OnFailure func()
}

// Lookup answers ISP queries, caching successful responses.
type Lookup struct {
	opt    Options
	client *http.Client

	mu    sync.Mutex
	cache map[netip.Addr]entry
}

type entry struct {
	info    Info
	expires time.Time
}

const maxCacheEntries = 4096

// New builds a Lookup from opt.
func New(opt Options) *Lookup {
	if opt.Timeout <= 0 {
		opt.Timeout = 2500 * time.Millisecond
	}
	if opt.CacheTTL <= 0 {
		opt.CacheTTL = 6 * time.Hour
	}
	return &Lookup{
		opt:    opt,
		client: &http.Client{Timeout: opt.Timeout},
		cache:  make(map[netip.Addr]entry),
	}
}

// Do returns what is known about addr. It never returns an error: an
// unreachable provider degrades to the locally derivable answer.
func (l *Lookup) Do(ctx context.Context, addr netip.Addr) Info {
	base := Info{IP: netutil.String(addr), Private: netutil.IsPrivate(addr)}
	if !addr.IsValid() {
		return base
	}
	if base.Private {
		base.ISP = "Private network"
		return base
	}
	if !l.opt.Enabled {
		return base
	}
	if cached, ok := l.get(addr); ok {
		return cached
	}

	if l.opt.OnLookup != nil {
		l.opt.OnLookup()
	}
	info, err := l.fetch(ctx, addr)
	if err != nil {
		if l.opt.OnFailure != nil {
			l.opt.OnFailure()
		}
		return base
	}
	info.IP = base.IP
	l.put(addr, info)
	return info
}

func (l *Lookup) get(addr netip.Addr) (Info, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	e, ok := l.cache[addr]
	if !ok || time.Now().After(e.expires) {
		return Info{}, false
	}
	return e.info, true
}

func (l *Lookup) put(addr netip.Addr, info Info) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.cache) >= maxCacheEntries {
		// Cheap bounded eviction: drop a slice of arbitrary entries rather than
		// tracking LRU state for a cache this small.
		n := 0
		for k := range l.cache {
			delete(l.cache, k)
			if n++; n >= maxCacheEntries/4 {
				break
			}
		}
	}
	l.cache[addr] = entry{info: info, expires: time.Now().Add(l.opt.CacheTTL)}
}

func (l *Lookup) fetch(ctx context.Context, addr netip.Addr) (Info, error) {
	ctx, cancel := context.WithTimeout(ctx, l.opt.Timeout)
	defer cancel()

	endpoint, parse := l.endpoint(addr)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Info{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "speedtest/1.0")

	resp, err := l.client.Do(req)
	if err != nil {
		return Info{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Info{}, fmt.Errorf("ipinfo: provider returned %s", resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return Info{}, err
	}
	return parse(body)
}

func (l *Lookup) endpoint(addr netip.Addr) (string, func([]byte) (Info, error)) {
	ip := url.PathEscape(addr.String())
	switch l.opt.Provider {
	case "ipinfo":
		u := "https://ipinfo.io/" + ip + "/json"
		if l.opt.Token != "" {
			u += "?token=" + url.QueryEscape(l.opt.Token)
		}
		return u, parseIPInfo
	default: // "ipapi"
		return "http://ip-api.com/json/" + ip +
			"?fields=status,message,country,city,isp,org,as", parseIPAPI
	}
}

func parseIPAPI(b []byte) (Info, error) {
	var v struct {
		Status  string `json:"status"`
		Message string `json:"message"`
		Country string `json:"country"`
		City    string `json:"city"`
		ISP     string `json:"isp"`
		Org     string `json:"org"`
		AS      string `json:"as"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return Info{}, err
	}
	if v.Status != "success" {
		return Info{}, fmt.Errorf("ipinfo: ip-api: %s", v.Message)
	}
	isp := v.ISP
	if isp == "" {
		isp = v.Org
	}
	asn, _, _ := strings.Cut(v.AS, " ")
	return Info{ISP: isp, ASN: asn, Country: v.Country, City: v.City}, nil
}

func parseIPInfo(b []byte) (Info, error) {
	var v struct {
		City    string `json:"city"`
		Country string `json:"country"`
		Org     string `json:"org"` // "AS15169 Google LLC"
		Error   *struct {
			Title string `json:"title"`
		} `json:"error"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return Info{}, err
	}
	if v.Error != nil {
		return Info{}, fmt.Errorf("ipinfo: %s", v.Error.Title)
	}
	asn, isp, found := strings.Cut(v.Org, " ")
	if !found || !strings.HasPrefix(asn, "AS") {
		asn, isp = "", v.Org
	}
	return Info{ISP: isp, ASN: asn, Country: v.Country, City: v.City}, nil
}
