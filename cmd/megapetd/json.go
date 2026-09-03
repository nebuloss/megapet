package main

import (
	"encoding/json"
	"io"
)

func newIndentedJSON(w io.Writer) *json.Encoder {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc
}
