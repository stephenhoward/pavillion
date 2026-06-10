# Caddy extras.d — per-instance snippets

This directory is an extension point for the standalone-mode Caddyfile. Drop
files named `*.caddyfile` here to add handlers that should only exist on
this specific instance (e.g., a staging server's auto-deploy webhook
listener). Snippet files in this directory are gitignored; only this README
is tracked.

## How it works

The tracked `Caddyfile` ends with:

```caddy
{$DOMAIN} {
    encode gzip zstd

    import /etc/caddy/extras.d/*.caddyfile

    handle {
        reverse_proxy app:3000
    }
}
```

The `import` line expands inline at config-load time. Each snippet's
`handle` blocks are evaluated before the catch-all `handle { reverse_proxy
app:3000 }`, so matchers in your snippets take precedence over the default
app proxy. With no snippets present, Caddy logs one info-level "no files
matching import glob pattern" line and serves the default config.

## Example: staging auto-deploy webhook

`caddy-extras.d/hooks.caddyfile`:

```caddy
handle /hooks/* {
    reverse_proxy host.docker.internal:9000
}
```

The `caddy` service in `docker-compose.yml` already declares the
`host.docker.internal:host-gateway` extra host, so the upstream resolves to
the container host on Linux without further configuration. Any process
listening on port 9000 on the host (webhookd, a custom listener, etc.)
will receive forwarded `/hooks/*` requests.

## Conventions

- One concern per snippet file. Multiple snippets are concatenated in glob
  order, so prefix filenames with a number if order matters
  (`10-hooks.caddyfile`, `20-something-else.caddyfile`).
- Snippets contain only directives that are valid inside a site block —
  typically `handle`, `route`, `redir`, `respond`, etc. They cannot open a
  new site block of their own (that would need a top-level import, which
  this extension point does not provide).
- Validate after editing:
  ```bash
  docker compose --profile standalone exec caddy caddy validate --config /etc/caddy/Caddyfile
  ```

## Trust-proxy constraint

The tracked `Caddyfile` strips all client-supplied forwarding headers
(`X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Real-IP`,
`Forwarded`, `CF-Connecting-IP`, `True-Client-IP`) at the top of the site
block. Caddy executes `request_header` before `reverse_proxy` in its canonical
directive order, so the strips apply to every request — and to any proxying an
imported snippet performs — regardless of where the directives sit in the file.
Express runs with `trust proxy: 1` — it trusts exactly one upstream hop's
`X-Forwarded-For`, and that hop must be Caddy. This is what makes `req.ip` (used
for rate limiting and moderation IP records) trustworthy. Two cases are easy to
confuse:

- **A snippet that proxies to its own backend — NOT a concern.** A snippet that
  `reverse_proxy`s to its own upstream (e.g. the `/hooks/*` example above)
  receives headers Caddy has already sanitised and regenerated. There is
  nothing to do; this is safe by default. Snippets must not re-add a
  client-supplied forwarding header (e.g. via `request_header +` or `header_up`
  sourced from a client header) — that would undo the site-level strip.

- **A proxy or CDN placed *upstream* of Caddy — the real footgun.** Caddy must
  remain the **outermost trusted hop**. If you front this stack with a CDN or
  load balancer (Cloudflare, an external LB, etc.), the trust boundary moves
  one hop out and the header-strip protection no longer covers it. To keep
  `req.ip` trustworthy you must BOTH:
  1. Bump Express `trust proxy` (in `src/server/server.ts`) to match the new
     total hop count, AND
  2. Ensure the new outermost hop strips client-supplied forwarding headers
     before forwarding inward.

  Doing only one re-opens the spoofing hole one hop up. Changing the hop count
  is an operator decision, not a default — the shipped single-Caddy topology
  uses `1`.
