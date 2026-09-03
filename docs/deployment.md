# Deploying

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
