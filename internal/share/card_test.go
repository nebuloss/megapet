package share

import (
	"encoding/xml"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/nebuloss/speedtest/internal/store"
)

func TestRenderProducesWellFormedSVG(t *testing.T) {
	var sb strings.Builder
	err := Render(&sb, Card{
		Title:  "Speedtest",
		Accent: "#4F6BED",
		Result: store.Result{
			ID:           "1PDASEXH1P",
			CreatedAt:    time.Date(2026, 9, 3, 9, 47, 0, 0, time.UTC),
			DownloadMbps: 942.31,
			UploadMbps:   918.4,
			PingMs:       0.42,
			JitterMs:     0.08,
			ISP:          "Private network",
			ServerName:   "This server",
		},
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}

	out := sb.String()
	decoder := xml.NewDecoder(strings.NewReader(out))
	for {
		if _, err := decoder.Token(); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("rendered card is not well-formed XML: %v", err)
		}
	}

	for _, want := range []string{"942", "918", "1PDASEXH1P", "Private network", "#4F6BED"} {
		if !strings.Contains(out, want) {
			t.Errorf("card is missing %q", want)
		}
	}
}

// A title or ISP is attacker-influenced in the sense that it comes from config
// or an upstream API, so it must never be able to inject markup.
func TestRenderEscapesText(t *testing.T) {
	var sb strings.Builder
	if err := Render(&sb, Card{
		Title:  `</text><script>alert(1)</script>`,
		Result: store.Result{ISP: `"><rect/>`},
	}); err != nil {
		t.Fatal(err)
	}
	out := sb.String()
	if strings.Contains(out, "<script>") {
		t.Error("title was not escaped")
	}
	if strings.Contains(out, "<rect/>") {
		t.Error("ISP was not escaped")
	}

	decoder := xml.NewDecoder(strings.NewReader(out))
	for {
		if _, err := decoder.Token(); err == io.EOF {
			break
		} else if err != nil {
			t.Fatalf("escaped card is not well-formed XML: %v", err)
		}
	}
}

func TestRenderRejectsBogusAccent(t *testing.T) {
	var sb strings.Builder
	if err := Render(&sb, Card{Accent: `red" onload="x`}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(sb.String(), "onload") {
		t.Error("a non-hex accent colour reached the output")
	}
}

func TestFormatHelpers(t *testing.T) {
	tests := []struct {
		got, want string
	}{
		{formatSpeed(0), "—"},
		{formatSpeed(9.456), "9.46"},
		{formatSpeed(94.56), "94.6"},
		{formatSpeed(945.6), "946"},
		{formatMs(0), "—"},
		{formatMs(0.42), "0.4 ms"},
		{formatMs(120), "120 ms"},
		{formatBytes(512), "512 B"},
		{formatBytes(1536), "1.5 KiB"},
		{formatBytes(1 << 30), "1.0 GiB"},
	}
	for _, tc := range tests {
		if tc.got != tc.want {
			t.Errorf("got %q, want %q", tc.got, tc.want)
		}
	}
}
