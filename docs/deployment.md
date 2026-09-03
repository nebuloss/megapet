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
