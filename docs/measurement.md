# How the measurement works

Every number this tool reports is produced by the browser, so it is worth
knowing exactly what is being counted and what is deliberately thrown away.
**Latency.** The client sends `ping_count` empty requests back to back, after
`ping_warmup` throwaway probes. Where the browser exposes Resource Timing (the
server sends `Timing-Allow-Origin: *`, so this works cross-origin too) the round
trip is taken as `responseStart - requestStart`, which excludes the scheduling
and body-handling overhead a wall-clock measurement around `fetch` would
include. The headline **Ping** is the *minimum* round trip — the propagation
floor, and the same statistic LibreSpeed reports, so numbers stay comparable
during a migration. Minimum and maximum are stored alongside it.

**Jitter** is the mean absolute difference between consecutive round trips.

**Reversing.** Between phases the test holds for as long as the visual says it
needs (`SpeedVisual.transitionMs`): the reading is pinned to zero, the dial
settles, and the drive train changes direction with nothing else moving. On the
lift that is ~1.75 s each side, so a run costs about 3.5 s more than the raw
measurement; the plain dial pauses for 0.4 s.

**Throughput.** `download_streams` (or `upload_streams`) workers run
concurrently for the configured duration. Bytes are accumulated continuously,
but the reported figure covers only the window *after* `grace_seconds` — during
the first second or so TCP is still growing its congestion window, and including
it would systematically understate a fast link. The gauge shows a shorter
trailing window so it stays responsive; the final number is the whole
measurement window.

**Why parallel streams.** A single TCP connection on a high bandwidth-delay
link is limited by window size and by any single packet loss. Six streams is
enough to saturate a gigabit LAN and most WAN links; raise it for 10 GbE.

**Payload.** The server holds a 16 MiB pool of `crypto/rand` bytes and serves
from a rotating offset, so no two streams send the same bytes in the same order.
Responses carry `Content-Encoding: identity` and `Cache-Control: no-store`, so
nothing on the path can compress or cache its way to a fictional result. You can
verify this: `curl -s 'localhost:8080/api/download?bytes=1048576' | gzip | wc -c`
returns *more* than 1048576.

**Upload accounting.** `XMLHttpRequest.upload.onprogress` reports bytes handed
to the socket, which can lead the wire by whatever is sitting in the kernel send
buffer. Over a ten-second window that is well under a percent. The server
returns the byte count it actually received so the two can be reconciled.


## Related

- [configuration.md](configuration.md) — the knobs described above
- [api.md](api.md) — the endpoints these phases drive
