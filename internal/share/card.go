// Package share renders a result as a self-contained SVG card suitable for
// embedding in a chat message, a wiki page or an <img> tag.
package share

import (
	"fmt"
	"html"
	"io"
	"strings"
	"time"

	"github.com/nebuloss/megapet/internal/store"
)

// Card describes what to draw.
type Card struct {
	Title  string
	Result store.Result
	Accent string // hex seed colour, e.g. "#4F6BED"
}

// Render writes the SVG document to w.
func Render(w io.Writer, c Card) error {
	accent := c.Accent
	if !isHexColor(accent) {
		accent = "#4F6BED"
	}
	title := c.Title
	if title == "" {
		title = "Megapet"
	}

	r := c.Result
	subtitle := r.CreatedAt.UTC().Format("2 Jan 2006 15:04 MST")
	if r.ISP != "" {
		subtitle = r.ISP + "  ·  " + subtitle
	}
	if r.ServerName != "" {
		subtitle = r.ServerName + "  ·  " + subtitle
	}

	const (
		width  = 1000
		height = 460
	)

	var b strings.Builder
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s result">`,
		width, height, width, height, esc(title))
	fmt.Fprintf(&b, `<title>%s — %s down / %s up</title>`,
		esc(title), esc(formatSpeed(r.DownloadMbps)), esc(formatSpeed(r.UploadMbps)))

	// Background: a soft vertical wash tinted by the accent colour.
	fmt.Fprintf(&b, `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#12131A"/><stop offset="1" stop-color="#1B1D28"/>
</linearGradient>
<radialGradient id="glow" cx="0.85" cy="0.1" r="0.9">
<stop offset="0" stop-color="%s" stop-opacity="0.28"/><stop offset="1" stop-color="%s" stop-opacity="0"/>
</radialGradient>
</defs>`, accent, accent)
	fmt.Fprintf(&b, `<rect width="%d" height="%d" rx="32" fill="url(#bg)"/>`, width, height)
	fmt.Fprintf(&b, `<rect width="%d" height="%d" rx="32" fill="url(#glow)"/>`, width, height)

	const font = `font-family="Roboto,'Segoe UI',system-ui,-apple-system,sans-serif"`

	// Header.
	fmt.Fprintf(&b, `<circle cx="64" cy="66" r="14" fill="%s"/>`, accent)
	fmt.Fprintf(&b, `<text x="92" y="74" %s font-size="26" font-weight="600" fill="#E5E1E9">%s</text>`,
		font, esc(title))
	fmt.Fprintf(&b, `<text x="%d" y="74" %s font-size="18" fill="#A7A3AE" text-anchor="end">%s</text>`,
		width-56, font, esc(subtitle))
	fmt.Fprintf(&b, `<line x1="56" y1="104" x2="%d" y2="104" stroke="#33353F" stroke-width="1.5"/>`, width-56)

	// Two headline figures.
	headline := func(x int, label, value, unit, color string) {
		fmt.Fprintf(&b, `<text x="%d" y="164" %s font-size="18" letter-spacing="1.5" fill="#A7A3AE">%s</text>`,
			x, font, esc(strings.ToUpper(label)))
		fmt.Fprintf(&b, `<text x="%d" y="252" %s font-size="82" font-weight="700" fill="%s">%s</text>`,
			x, font, color, esc(value))
		fmt.Fprintf(&b, `<text x="%d" y="288" %s font-size="20" fill="#A7A3AE">%s</text>`,
			x, font, esc(unit))
	}
	headline(56, "Download", formatSpeed(r.DownloadMbps), "Mbps", accent)
	headline(520, "Upload", formatSpeed(r.UploadMbps), "Mbps", "#7ED8A8")

	// Secondary chips.
	chip := func(x int, label, value string) {
		fmt.Fprintf(&b, `<rect x="%d" y="330" width="200" height="82" rx="20" fill="#22242E"/>`, x)
		fmt.Fprintf(&b, `<text x="%d" y="360" %s font-size="15" letter-spacing="1.2" fill="#A7A3AE">%s</text>`,
			x+20, font, esc(strings.ToUpper(label)))
		fmt.Fprintf(&b, `<text x="%d" y="394" %s font-size="28" font-weight="600" fill="#E5E1E9">%s</text>`,
			x+20, font, esc(value))
	}
	chip(56, "Ping", formatMs(r.PingMs))
	chip(276, "Jitter", formatMs(r.JitterMs))
	chip(496, "Transferred", formatBytes(r.DownloadBytes+r.UploadBytes))

	if r.ID != "" {
		fmt.Fprintf(&b, `<text x="%d" y="394" %s font-size="16" fill="#6F6B78" text-anchor="end">#%s</text>`,
			width-56, font, esc(r.ID))
	}
	b.WriteString(`</svg>`)

	_, err := io.WriteString(w, b.String())
	return err
}

func formatSpeed(mbps float64) string {
	switch {
	case mbps <= 0:
		return "—"
	case mbps >= 1000:
		return fmt.Sprintf("%.0f", mbps)
	case mbps >= 100:
		return fmt.Sprintf("%.0f", mbps)
	case mbps >= 10:
		return fmt.Sprintf("%.1f", mbps)
	default:
		return fmt.Sprintf("%.2f", mbps)
	}
}

func formatMs(ms float64) string {
	if ms <= 0 {
		return "—"
	}
	if ms >= 100 {
		return fmt.Sprintf("%.0f ms", ms)
	}
	return fmt.Sprintf("%.1f ms", ms)
}

func formatBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit && exp < 4; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTP"[exp])
}

func esc(s string) string { return html.EscapeString(s) }

func isHexColor(s string) bool {
	if len(s) != 7 || s[0] != '#' {
		return false
	}
	for i := 1; i < len(s); i++ {
		c := s[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}

// MaxAge is how long a rendered card may be cached; results are immutable once
// written, so this can be generous.
const MaxAge = 24 * time.Hour
