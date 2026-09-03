# Security

## Reporting a vulnerability

Please report privately, not in a public issue:
**[open a draft advisory](https://github.com/nebuloss/megapet/security/advisories/new)**
under the repository's Security tab.

Include what you did, what happened, and what you expected. A minimal
reproduction helps more than anything else. You'll get an acknowledgement and
a view on whether it looks like a real issue; if it is, we'll agree a
disclosure timeline.

Deliberately no email address here — the reporting channel is GitHub's, so
nothing has to be published to be reachable.

## What this software is, from a security point of view

Worth being explicit, because it is unusual: **megapetd deliberately serves and
consumes very large amounts of bandwidth to unauthenticated clients.** That is
its function. The download endpoint will stream as much as a client asks for,
and the upload endpoint will read whatever it is sent.

That means the following are *by design*, not bugs:

- `/api/download`, `/api/upload` and `/api/ping` require no authentication.
- Those endpoints send permissive CORS headers, so any origin can run a test
  against your server. They carry no credentials and expose no data.
- Results submitted to `/api/results` are measured by the browser and cannot be
  verified server-side. They are clamped against NaN, infinities, negatives and
  absurd magnitudes, but a determined client can still post a plausible lie.

The protections that do exist, and are worth configuring:

| Setting | What it limits |
| --- | --- |
| `limits.max_bytes_per_request` | The most one request can transfer. |
| `limits.max_streams_per_ip` | Concurrent transfers from one address. |
| `limits.max_streams_total` | Concurrent transfers overall. |
| `trusted_proxies` | Which CIDRs may set `X-Forwarded-For`. Leave empty and forwarding headers are ignored entirely. |
| `store.record_ip` / `store.anonymize_ip` | Whether client addresses are stored, and whether the host portion is masked first. |
| `ipinfo.enabled` | Outbound ISP lookups. **Off by default** — the server does not contact anything external unless you turn this on. |

If you expose this to the internet, put it behind a reverse proxy, set
`trusted_proxies`, and set the limits to something your uplink can afford.

## Scope

In scope: anything that lets a client read or alter data it should not, escape
the configured limits, or attack the host. Also anything where the server
contacts a third party without `ipinfo.enabled` being set.

Out of scope: that the measurement endpoints are unauthenticated, that CORS is
permissive on them, and that a client can submit an untrue result. Those are
the design, documented above.
