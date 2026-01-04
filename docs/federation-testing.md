# Federation Testing

Pavillion includes a comprehensive federation testing infrastructure that allows you to test ActivityPub federation between multiple Pavillion instances on your local machine. This is essential for developing and verifying federation features without needing multiple production servers.

## Overview

The federation testing setup creates two Pavillion instances (`alpha.federation.local` and `beta.federation.local`) running in Docker containers with:
- Separate PostgreSQL databases for complete isolation
- nginx reverse proxy with HTTPS for hostname-based routing
- Auto-generated self-signed SSL certificates for local HTTPS testing
- HTTP signature verification bypass for simplified local testing
- Playwright E2E tests to verify federation scenarios

## Prerequisites

### 1. Docker and Docker Compose

Ensure you have Docker and Docker Compose installed:

```bash
docker --version
docker compose version
```

### 2. Configure /etc/hosts (One-Time Setup)

**IMPORTANT:** You must manually add the following entries to your `/etc/hosts` file to allow your browser and test runners to resolve the federation domains:

```bash
# Add these lines to /etc/hosts
127.0.0.1 alpha.federation.local
127.0.0.1 beta.federation.local
```

**On macOS/Linux:**
```bash
sudo nano /etc/hosts
# Add the two lines above, save, and exit
```

**On Windows:**
```powershell
# Run as Administrator
notepad C:\Windows\System32\drivers\etc\hosts
# Add the two lines above, save, and exit
```

**Why is this needed?**
Docker containers can resolve each other using Docker's internal DNS (through network aliases), but your host machine (where your browser and Playwright run) needs these `/etc/hosts` entries to resolve `.federation.local` domains to `localhost` (127.0.0.1). The nginx reverse proxy running in Docker then routes requests to the correct instance based on the Host header.

## Quick Start

Once prerequisites are met, testing federation is straightforward:

```bash
# 1. Start the federation environment (both instances + nginx)
# SSL certificates will be automatically generated on first run
npm run federation:start

# 2. Wait for instances to be healthy (about 60 seconds)
# You can monitor startup with:
npm run federation:logs

# 3. Run federation tests
npm run test:federation

# 4. Stop the environment when done
npm run federation:stop
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run federation:start` | Start both Pavillion instances with nginx reverse proxy (auto-generates SSL certificates if missing) |
| `npm run federation:stop` | Stop all federation containers |
| `npm run federation:logs` | View real-time logs from all containers |
| `npm run federation:reset` | Stop containers, delete volumes, and start fresh |
| `npm run test:federation` | Run Playwright federation E2E tests |

## SSL Certificate Generation

The federation environment uses HTTPS with self-signed SSL certificates for secure communication between instances. These certificates are **automatically generated** when you run `npm run federation:start` for the first time.

**How it works:**
1. When you run `npm run federation:start`, the script checks for existing SSL certificates
2. If certificates are missing, it automatically runs `docker/federation/ssl/generate-certs.sh`
3. The script generates self-signed certificates for both `alpha.federation.local` and `beta.federation.local`
4. Certificates are valid for 365 days and use RSA 2048-bit encryption
5. The Docker containers are configured to trust these certificates via `NODE_TLS_REJECT_UNAUTHORIZED=0`

**Manual regeneration:**
If you need to regenerate the certificates (e.g., after they expire), you can:
```bash
# Delete existing certificates
rm docker/federation/ssl/*.crt docker/federation/ssl/*.key

# Restart federation (will auto-generate new certificates)
npm run federation:start
```

Or run the generation script directly:
```bash
./docker/federation/ssl/generate-certs.sh
```

**Security Note:** These self-signed certificates are for local testing only and should never be used in production.

## Federation Test Scenarios

The federation test suite covers the following scenarios:

### 1. WebFinger Discovery (`tests/e2e/federation/webfinger.spec.ts`)
- Instance B discovers Instance A's calendar via WebFinger protocol
- Verifies WebFinger response format and ActivityPub profile URL
- Validates that the ActivityPub actor document is correctly formatted

### 2. Follow/Unfollow (`tests/e2e/federation/follow.spec.ts`)
- Instance B follows a calendar on Instance A
- Verifies Follow activity is delivered to Instance A's inbox
- Verifies Instance A sends Accept activity
- Tests unfollowing (Undo Follow activity)

### 3. Event Propagation (`tests/e2e/federation/events.spec.ts`)
- Instance A creates an event on a calendar
- Instance B follows Instance A's calendar
- Verifies Create(Event) activity is delivered to Instance B
- Verifies event appears in Instance B's follower feed
- Tests event updates (Update activity propagation)

## Accessing Instances in Browser

Once the federation environment is running, you can access both instances in your browser:

- Alpha (Instance A): https://alpha.federation.local
- Beta (Instance B): https://beta.federation.local

**Login Credentials:**
- Email: `admin@pavillion.dev`
- Password: `admin`

**Note:** Both instances use HTTPS with self-signed certificates. Your browser will show a security warning - this is expected for local development. Click "Advanced" and "Proceed" to continue. Both instances use the same seed data, so the admin credentials are identical.

## Example Federation Testing Workflow

Here's a typical workflow when developing or verifying a federation feature:

```bash
# 1. Start the federation environment
npm run federation:start

# 2. Monitor logs in one terminal
npm run federation:logs

# 3. In another terminal, run the federation tests
npm run test:federation

# 4. Or manually test in browser:
# - Open https://alpha.federation.local (accept the security warning)
# - Log in with admin@pavillion.dev / admin
# - Create a calendar and event
# - Open https://beta.federation.local in another tab (accept the security warning)
# - Log in and follow Alpha's calendar
# - Verify the event appears in Beta's feed

# 5. When done, stop the environment
npm run federation:stop
```

## Troubleshooting

### Instances won't start / healthcheck failing

**Problem:** Containers are stuck in "starting" state or healthcheck keeps failing.

**Solutions:**
1. Check logs to see what's failing:
   ```bash
   npm run federation:logs
   ```
2. Ensure port 80 is not in use by another service:
   ```bash
   lsof -i :80
   ```
3. Try a clean restart:
   ```bash
   npm run federation:reset
   ```

### Cannot access alpha.federation.local or beta.federation.local in browser

**Problem:** Browser shows "This site can't be reached" or similar error.

**Solutions:**
1. Verify `/etc/hosts` entries are correct:
   ```bash
   cat /etc/hosts | grep federation.local
   ```
   Should show:
   ```
   127.0.0.1 alpha.federation.local
   127.0.0.1 beta.federation.local
   ```
2. Verify nginx container is running:
   ```bash
   docker ps | grep pavillion-federation-nginx
   ```
3. Check that instances are healthy:
   ```bash
   docker ps
   # Look for "healthy" status on pavillion-federation-alpha and pavillion-federation-beta
   ```

### Federation tests fail with network errors

**Problem:** Playwright tests fail with connection refused or timeout errors.

**Solutions:**
1. Ensure federation environment is running:
   ```bash
   docker ps
   ```
2. Verify instances are healthy (not just "starting"):
   ```bash
   docker ps --format "table {{.Names}}\t{{.Status}}"
   ```
3. Check that nginx is routing correctly:
   ```bash
   curl -k -H "Host: alpha.federation.local" https://localhost/health
   curl -k -H "Host: beta.federation.local" https://localhost/health
   ```
   Note: The `-k` flag tells curl to accept the self-signed SSL certificate.

### Database state is causing test failures

**Problem:** Tests fail because of existing data from previous test runs.

**Solution:**
The instances are configured with `DB_RESET=true`, which resets the database on each container start. To get a completely fresh environment:
```bash
npm run federation:reset
```

### HTTP Signature verification errors

**Problem:** Activities are being rejected due to signature verification failures.

**Note:** The federation environment is configured with `SKIP_SIGNATURES=true` to bypass HTTP signature verification. This simplifies local testing. If you see signature errors:
1. Check that the environment variable is set in `docker-compose.federation.yml`
2. Restart the environment:
   ```bash
   npm run federation:stop
   npm run federation:start
   ```

### View detailed container logs

To view logs for a specific container:
```bash
# Alpha instance logs
docker logs pavillion-federation-alpha -f

# Beta instance logs
docker logs pavillion-federation-beta -f

# nginx logs
docker logs pavillion-federation-nginx -f

# Database logs
docker logs pavillion-federation-db-alpha -f
docker logs pavillion-federation-db-beta -f
```

## Architecture Overview

The federation testing infrastructure consists of:

```
+------------------+
|  Browser/Tests   |
+--------+---------+
         |
         v
+------------------+
|      nginx       |  ← Routes by Host header
|    (port 80)     |
+--------+---------+
         |
   +-----+-----+
   |           |
   v           v
+--------+  +--------+
| alice  |  |  bob   |
| :3000  |  | :3000  |  ← Pavillion instances
+---+----+  +---+----+
    |           |
    v           v
+--------+  +--------+
|db_alice|  | db_bob |  ← PostgreSQL databases
+--------+  +--------+
```

**Key Components:**

1. **nginx reverse proxy** - Routes HTTP requests based on the Host header to the correct Pavillion instance
2. **instance_alice** - First Pavillion instance (alice.federation.local)
3. **instance_bob** - Second Pavillion instance (bob.federation.local)
4. **db_alice / db_bob** - Isolated PostgreSQL databases for each instance
5. **federation_net** - Custom Docker bridge network enabling DNS resolution between containers

**Configuration Files:**
- `docker-compose.federation.yml` - Docker Compose configuration for all services
- `docker/federation/nginx.conf` - nginx routing configuration
- `config/federation.yaml` - Pavillion configuration overrides for federation testing
- `playwright.federation.config.ts` - Playwright configuration for federation E2E tests

**Test Files:**
- `tests/e2e/federation/webfinger.spec.ts` - WebFinger discovery tests
- `tests/e2e/federation/follow.spec.ts` - Follow/unfollow tests
- `tests/e2e/federation/events.spec.ts` - Event propagation tests
- `tests/e2e/federation/helpers/api.ts` - API helpers for programmatic test setup
- `tests/e2e/federation/helpers/instances.ts` - Instance configuration and helpers

**Unit Test Utilities:**
- `src/server/activitypub/test/helpers/fedify-mock.ts` - Fedify-based mocking utilities for unit tests
- `src/server/activitypub/test/helpers/fedify-mock.test.ts` - Tests for the mock utilities

## Security Note

The federation testing environment has HTTP signature verification disabled (`SKIP_SIGNATURES=true`) to simplify local testing. This is appropriate for development but **must never be used in production**. When the environment starts with signatures disabled, you'll see a prominent warning in the logs:

```
========================================
WARNING: HTTP Signature Verification DISABLED
This is ONLY appropriate for local testing!
NEVER use SKIP_SIGNATURES=true in production!
========================================
```
