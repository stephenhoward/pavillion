---
description: Configure a Pavillion instance — config/local.yaml, environment variables, and the layered config priority that determines which setting actually takes effect.
---

# Configure your instance

> Status: placeholder. This guide will be written before launch.

Reference for everything you can tune. Pavillion uses layered configuration — defaults in the image, production overrides in the image, your `config/local.yaml` on a bind mount, and environment variables on top of all of it. This guide explains the layering and walks through the settings that actually matter.

## Planned scope

- The config priority chain: env vars > `config/local.yaml` > `config/production.yaml` > `config/default.yaml`, and what each layer is for
- Which settings belong in `local.yaml` (instance-specific overrides — domain, email, branding) and which belong in `.env` (secrets and deploy-specific values)
- Required settings vs. settings with sane defaults
- The most consequential knobs, in prose: domain, email transport, media storage backend, federation toggles
- A reference table of every environment variable at the bottom for fast lookup
- The "I changed a setting and nothing happened" debugging path: restart the container, check the layer that actually won
