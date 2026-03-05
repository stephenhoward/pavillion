# Staging Auto-Deploy Setup

Automated deployment from GitHub Actions to a Hetzner staging VPS using a webhook listener.

## How It Works

1. A push to `main` triggers the CI pipeline
2. After CI succeeds, the `Deploy to Staging` workflow fires
3. The workflow sends an HMAC-signed POST to the staging server
4. The webhook listener validates the signature and runs `deploy.sh`
5. `deploy.sh` pulls new images, restarts containers, and prunes old images

## Why Webhook Instead of SSH

GitHub Actions runners use dynamic IP addresses that change between runs. Allowing SSH access would require either:
- Opening port 22 to all GitHub runner IPs (security risk)
- Maintaining an IP allowlist that changes frequently (operational burden)

The webhook approach exposes only an HTTPS endpoint (behind Caddy with TLS and rate limiting) that validates requests using HMAC-SHA256 signatures. No SSH port exposure needed.

## Setup Instructions

### 1. Provision the Server

Run the provisioning script with the `--staging` flag to install the webhook package and create its systemd service:

```bash
ssh root@your-server 'bash -s -- --staging' < bin/provision.sh
```

### 2. Copy Deploy Files

SSH to the server as the deploy user and copy the deploy script and webhook config:

```bash
ssh pavillion@your-server

# Copy deploy script
cp /opt/pavillion/docker/staging/deploy.sh /opt/pavillion/deploy.sh
chmod 750 /opt/pavillion/deploy.sh

# Copy webhook config
cp /opt/pavillion/docker/staging/hooks.json /opt/pavillion/hooks.json
chmod 600 /opt/pavillion/hooks.json
```

### 3. Generate and Set Webhook Secret

```bash
# Generate a secret
SECRET=$(openssl rand -hex 32)
echo "Save this secret for GitHub: $SECRET"

# Substitute the placeholder in hooks.json
sed -i "s/REPLACE_WITH_WEBHOOK_SECRET/${SECRET}/" /opt/pavillion/hooks.json
```

### 4. Start the Webhook Service

```bash
sudo systemctl start webhook
sudo systemctl status webhook
```

### 5. Update Caddy Config

Replace the production Caddyfile with the staging version:

```bash
cp /opt/pavillion/docker/staging/Caddyfile.staging /opt/pavillion/Caddyfile
# Restart Caddy (via docker compose or systemctl, depending on your setup)
```

### 6. Add GitHub Secrets

In your GitHub repository settings, add these secrets under the `staging` environment:

- **`STAGING_HOST`**: The domain name of your staging server (e.g., `staging.pavillion.dev`)
- **`DEPLOY_WEBHOOK_SECRET`**: The secret generated in step 3

### 7. Verify

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
| `hooks.json` | `600` | `pavillion` | Contains the webhook secret |
| `deploy.sh` | `750` | `pavillion` | Executable by owner and group |
| `deploy.log` | `640` | `pavillion` | Created automatically by deploy.sh |

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
- Verify hooks.json is at `/opt/pavillion/hooks.json`
- Check Caddy is proxying `/hooks/*` to `localhost:9000`

### Webhook returns 200 but nothing happens

- Check deploy.log for errors: `tail -20 /opt/pavillion/deploy.log`
- Verify deploy.sh is executable: `ls -la /opt/pavillion/deploy.sh`
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
