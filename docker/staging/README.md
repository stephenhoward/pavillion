# Staging Auto-Deploy Setup

Automated deployment from GitHub Actions to a Hetzner staging VPS using a webhook listener.

## How It Works

1. A push to `main` triggers the CI pipeline
2. After CI succeeds, the `Deploy to Staging` workflow fires
3. The workflow sends an HMAC-signed POST to the staging server, which Caddy forwards to the webhook listener via a `caddy-extras.d/hooks.caddyfile` snippet (see [`caddy-extras.d/README.md`](../../caddy-extras.d/README.md))
4. The webhook listener validates the signature and executes `docker/staging/deploy.sh` directly
5. `docker/staging/deploy.sh` invokes `bin/deploy.sh --non-interactive`, which handles secret management, migrations, container lifecycle, and health checks

## What this script does

The staging deploy webhook fires `docker/staging/deploy.sh`, which is a thin
wrapper around `bin/deploy.sh --non-interactive`. The wrapper adds:

1. **flock-based concurrency** — prevents overlapping deploys on the same
   machine.
2. **Log file** — writes all output to `/opt/pavillion/deploy.log` for
   post-hoc inspection.
3. **Image prune** — removes dangling images after a successful deploy.

All secret management, migrations, container lifecycle, and health checks
live in `bin/deploy.sh`. See `docs/upgrading.md` for the admin-facing
story.

## Why Webhook Instead of SSH

GitHub Actions runners use dynamic IP addresses that change between runs. Allowing SSH access would require either:
- Opening port 22 to all GitHub runner IPs (security risk)
- Maintaining an IP allowlist that changes frequently (operational burden)

The webhook approach exposes only an HTTPS endpoint (behind Caddy with TLS and rate limiting) that validates requests using HMAC-SHA256 signatures. No SSH port exposure needed.

## Setup Instructions

### 1. Provision the Server

Run the provisioning script with the `--staging` flag. This will provision the server, clone the repo, generate secrets, configure the webhook, and start the webhook service:

```bash
ssh root@your-server 'bash -s -- --staging --domain=staging.example.org' < bin/provision.sh
```

At the end, the script displays a **webhook secret** — save it immediately.

### 2. Add GitHub Secrets

In your GitHub repository settings, add these secrets under the `staging` environment:

- **`STAGING_HOST`**: The domain name of your staging server (e.g., `staging.pavillion.dev`)
- **`DEPLOY_WEBHOOK_SECRET`**: The webhook secret displayed at the end of provisioning

### 3. Verify

Test the webhook endpoint manually:

```bash
# Generate a test payload and signature
PAYLOAD='{"ref":"test","trigger":"manual"}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$YOUR_SECRET" | awk '{print $2}')

# Send the request
curl -v -X POST \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: sha256=${SIGNATURE}" \
  -d "$PAYLOAD" \
  "https://your-staging-domain/hooks/deploy-staging"
```

Check the logs:

```bash
# Webhook service logs
sudo journalctl -u webhook -f

# Deploy script logs
tail -f /opt/pavillion/deploy.log
```

## Security

### File Permissions

| File | Permissions | Owner | Notes |
|------|-------------|-------|-------|
| `/opt/pavillion/docker/staging/hooks.json` | `600` | `pavillion` | Contains the webhook secret. Generated from the sibling `hooks.json.example` during provisioning. Gitignored. |
| `/opt/pavillion/docker/staging/deploy.sh` | `750` | `pavillion` | Tracked. The webhook fires this directly (no root-level copy). |
| `/opt/pavillion/caddy-extras.d/hooks.caddyfile` | `644` | `pavillion` | Caddy snippet that proxies `/hooks/*` to the webhook listener. Written during provisioning into the gitignored `caddy-extras.d/` extension point. |
| `/opt/pavillion/deploy.log` | `640` | `pavillion` | Created automatically by `docker/staging/deploy.sh`. Gitignored. |

### Log Rotation

Add a logrotate config to prevent deploy.log from growing indefinitely:

```bash
sudo cat > /etc/logrotate.d/pavillion-deploy << 'EOF'
/opt/pavillion/deploy.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
}
EOF
```

### Token Rotation

To rotate the webhook secret:

1. Generate a new secret: `openssl rand -hex 32`
2. Update `hooks.json` on the server with the new secret
3. Restart the webhook service: `sudo systemctl restart webhook`
4. Update the `DEPLOY_WEBHOOK_SECRET` secret in GitHub repository settings
5. Trigger a test deploy to verify

## Troubleshooting

### Webhook returns 404

- Check that the webhook service is running: `sudo systemctl status webhook`
- Verify hooks.json is at `/opt/pavillion/docker/staging/hooks.json`
- Verify the Caddy snippet is in place: `cat /opt/pavillion/caddy-extras.d/hooks.caddyfile`
- Reload Caddy if you just added the snippet: `docker compose --profile standalone restart caddy`

### Webhook returns 200 but nothing happens

- Check deploy.log for errors: `tail -20 /opt/pavillion/deploy.log`
- Verify the staging deploy script is executable: `ls -la /opt/pavillion/docker/staging/deploy.sh`
- Check if a lockfile is stale: `ls -la /tmp/pavillion-deploy.lock`

### HMAC signature mismatch

- Verify the secret in hooks.json matches the GitHub secret exactly
- Check that no extra whitespace was added during `sed` substitution
- Re-generate and re-set the secret if needed (see Token Rotation)

### Deploy fails with Docker errors

- Check Docker is running: `sudo systemctl status docker`
- Verify the deploy user has Docker access: `docker ps`
- Check disk space: `df -h`
- Review full deploy log: `cat /opt/pavillion/deploy.log`

### GitHub workflow not triggering

- The workflow only triggers on successful CI runs on the `main` branch
- Fork PRs do not trigger deploys (head_repository guard)
- Check the Actions tab for workflow run status and logs
