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
