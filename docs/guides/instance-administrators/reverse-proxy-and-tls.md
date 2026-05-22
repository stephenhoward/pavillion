---
description: Put a TLS-terminating reverse proxy in front of Pavillion — when to use the bundled standalone Caddy and when to bring your own nginx, Caddy, or Traefik.
---

# Reverse proxy and TLS

> Status: placeholder. This guide will be written before launch.

Pavillion's app container listens on plain HTTP. Something else has to terminate TLS and pass traffic in. The two practical options are running your own reverse proxy (the usual choice if your server already hosts other things) or enabling the bundled standalone Caddy that ships with the Compose file. This guide names the choice and walks through both.

## Planned scope

- When standalone Caddy is the right pick: a dedicated server for Pavillion, you don't already run a proxy, you want automatic Let's Encrypt, you're willing to give Caddy ports 80 and 443
- When bringing your own proxy is the right pick: you already run nginx/Caddy/Traefik, the server hosts other apps, you have a separate TLS strategy, the bundled Caddy can't co-exist with what's there
- Example configs for nginx and Caddy (the WebSocket headers, the forwarded-proto, the X-Forwarded-For)
- Enabling standalone mode: `COMPOSE_PROFILES=standalone`, the `DOMAIN` requirement, restricting the app port to localhost
- The `caddy-extras.d/` extension point — what it's for, what's allowed inside a snippet, how to validate
- The "don't `docker compose down -v` your Caddy data volume" warning, with the rate-limit consequence spelled out
