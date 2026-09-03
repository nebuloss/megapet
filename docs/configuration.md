# Configuration

Layered: built-in defaults → JSON file → `MEGAPET_*` environment → flags.

```sh
megapetd -config /etc/megapet/megapet.json
megapetd -dump-config          # print the effective config and exit
megapetd -listen :9000 -db /var/lib/megapet/megapet.db
```

See [`configs/megapet.example.json`](../configs/megapet.example.json) for every field.

| Key | Default | Notes |
| --- | --- | --- |
| `listen` | `:8080` | Address to bind. |
| `base_url` | *(derived)* | Used to build share links behind a proxy. |
| `trusted_proxies` | *(none)* | CIDRs allowed to set `X-Forwarded-For`. Without this the socket peer is always used. |
| `test.download_seconds` | `10` | Per-phase duration. |
| `test.grace_seconds` | `1.5` | Ramp-up discarded from the measurement. |
| `test.download_streams` | `6` | Raise for 10 GbE, lower for a tiny box. |
| `test.overhead_factor` | `1.0` | `1.06` approximates line rate the way some consumer tools do. |
| `limits.max_streams_per_ip` | `16` | Stops one client monopolising the server. |
| `store.retention_days` | `365` | Older results are pruned daily. |
| `store.anonymize_ip` | `false` | Masks the last IPv4 octet / everything below the IPv6 /48. |
| `ipinfo.enabled` | `false` | Off by default: an internal speedtest should not phone home unless asked. Private addresses are labelled locally at no cost. |
| `ui.seed_color` | `#4F6BED` | Seeds the whole Material You palette. |

Common environment overrides: `MEGAPET_LISTEN`, `MEGAPET_DB`,
`MEGAPET_TITLE`, `MEGAPET_SEED_COLOR`, `MEGAPET_TRUSTED_PROXIES`,
`MEGAPET_DOWNLOAD_STREAMS`, `MEGAPET_ANONYMIZE_IP`,
`MEGAPET_IPINFO_ENABLED`.

### Multiple servers

List other backends under `servers` and the frontend grows a picker. When more
than one is configured and none is marked `"default": true`, the client probes
them all and preselects the closest. Cross-origin tests work because every
measurement endpoint sends permissive CORS and `Timing-Allow-Origin` headers —
they are unauthenticated and carry no credentials.

```json
"servers": [
  { "id": "par", "name": "Paris",  "url": "https://speed-par.example", "default": true },
  { "id": "lyn", "name": "Lyon",   "url": "https://speed-lyn.example" }
]
```

## Measuring past a reverse proxy

A proxy is the honest answer to *"how fast is this server for me"* — it is how
clients actually reach it. It is the wrong answer to *"how fast is this link"*:
every hop adds a copy per buffer, and with nginx's default `proxy_buffering on`
a download can read an order of magnitude low, because you end up timing the
proxy's disk rather than the network.

`direct` advertises an address that bypasses it. The page still loads, and
still saves its results, through the proxy; only ping, download and upload go
straight to the server.

```json
"direct": {
  "enabled": true,
  "url": ""
}
```

Leave `url` empty and it is derived from `listen` at startup — the primary
interface address plus the listening port. That guesses on a multi-homed host,
so set it explicitly if the guess is wrong:

```json
"direct": { "enabled": true, "url": "http://192.0.2.10:8080" }
```

The browser probes the address on load. If it answers it becomes the default
and the menu shows **Direct**; if it does not — a firewall, a different
network, a proxy that is the only route in — the page quietly stays on the
proxy path, because that measurement is still valid, just of a different thing.
A loopback listener advertises nothing, since it would send every client to
itself.

### The https catch

**A page served over https cannot measure against an http address.** Browsers
block it as mixed content, with no way for the page to detect or recover, so
megapet does not offer the option at all in that case.

If you terminate TLS at your proxy and still want the direct path, the server
has to speak https itself:

```json
"tls":    { "cert_file": "/etc/megapet/direct.crt", "key_file": "/etc/megapet/direct.key" },
"direct": { "enabled": true, "url": "https://speed-direct.example:8443" }
```

The certificate has to be one the browser already trusts — a self-signed one
fails silently, exactly like mixed content. In practice that means a second
hostname whose DNS points straight at the server rather than at the proxy.

The files are re-read when they change, so a certificate renewed by certbot,
Caddy or Nginx Proxy Manager is picked up without a restart. If a reload fails
— a renewal caught mid-write, say — the previous certificate keeps being served
rather than every connection being refused. See
[Nginx Proxy Manager](deployment.md#nginx-proxy-manager) for sharing NPM's
certificates.

On a plain http LAN deployment none of this applies: enable `direct` and it
works.

| Key | Default | Notes |
| --- | --- | --- |
| `direct.enabled` | `false` | Advertise a proxy-bypassing address. |
| `direct.url` | *(derived)* | Explicit address; overrides the guess. |
| `tls.cert_file` | *(none)* | Serve https directly. Must be set with the key. |
| `tls.key_file` | *(none)* | |
