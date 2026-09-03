# Deploying

The quickest route is the install script, which handles the user, config and
unit for you:

```sh
curl -fsSL https://raw.githubusercontent.com/nebuloss/megapet/main/scripts/install.sh | sh -s -- --systemd
```

The rest of this page is the manual equivalent.

## By hand
Copy `dist/megapetd` to `/usr/local/bin`, [the example config](../configs/megapet.example.json) to
`/etc/megapet/megapet.json`, and install the unit:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin megapet
sudo install -m755 dist/megapetd /usr/local/bin/megapetd
sudo install -Dm644 deploy/megapet.service /etc/systemd/system/megapet.service
sudo systemctl enable --now speedtest
```

Behind a reverse proxy, two settings matter more than usual, because getting
them wrong produces a *wrong number* rather than an error:

- **Turn buffering off** in both directions. The server already sends
  `X-Accel-Buffering: no` for nginx; see [`deploy/nginx.conf`](../deploy/nginx.conf)
  and [`deploy/Caddyfile`](../deploy/Caddyfile) for the rest.
- **Turn compression off** for the measurement endpoints.

Also set `trusted_proxies`, or every result will be recorded against the proxy's
address.


## Behind a reverse proxy

See [`deploy/nginx.conf`](../deploy/nginx.conf) and
[`deploy/Caddyfile`](../deploy/Caddyfile) for working examples, and
[configuration.md](configuration.md#trusted-proxies) for `trusted_proxies`.

## Two settings that change the number, not just the plumbing

Both are set in [`deploy/nginx.conf`](../deploy/nginx.conf), and both are
nginx defaults that get them wrong:

- **`proxy_buffering off`.** With buffering on, nginx reads the whole response
  before sending any of it, so the client times nginx rather than the network.
  Measured on loopback, that understated a download by **12×**. megapet also
  sends `X-Accel-Buffering: no`, which nginx honours per response.
- **`client_max_body_size 0`.** The default is 1 MB, so the upload phase gets a
  `413` and simply fails.

Also `gzip off` (the payload is random, so compression only burns CPU) and
`trusted_proxies` in megapet's own config, or every result is recorded against
the proxy's address instead of the client's.

Even correctly tuned, a proxy costs a hop. If you want the link measured rather
than the front door, see
[measuring past a reverse proxy](configuration.md#measuring-past-a-reverse-proxy).

## Nginx Proxy Manager

NPM is the common case where you do not control the nginx config file and the
certificates belong to something else. Two things to know.

**Downloads are already safe.** megapet sends `X-Accel-Buffering: no` on every
measurement response, and nginx honours that per response regardless of
`proxy_buffering`. You do not have to change anything for the download phase.

**Uploads are not.** There is no header equivalent for `proxy_request_buffering`,
so nginx will spool the whole upload body — hundreds of megabytes — before
forwarding a byte of it. Open the proxy host, go to **Advanced → Custom Nginx
Configuration**, and paste:

```nginx
proxy_request_buffering off;
client_max_body_size 0;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

`client_max_body_size` matters as much as the buffering: the nginx default is
1 MB, so without it the upload phase is rejected with a `413`.

Also set `trusted_proxies` in megapet's own config to the address NPM connects
from, or every result is recorded against NPM rather than the client.

### If you want the direct measurement path as well

With NPM terminating TLS, an https page cannot reach an `http://` direct
address — browsers block it as mixed content, so megapet does not offer the
option. Two ways round it:

- **Share NPM's certificate.** NPM keeps its Let's Encrypt certificates under
  its data volume, at `letsencrypt/live/npm-<id>/`. Point `tls.cert_file` and
  `tls.key_file` at those and give megapet a hostname of its own whose DNS
  points at the server rather than at NPM. megapet re-reads the files when they
  change, so a renewal is picked up without a restart.
- **Skip it.** With the snippet above, the only cost left is the proxy hop
  itself, which is invisible below about a gigabit. The direct path is worth
  the trouble mainly on faster links.
