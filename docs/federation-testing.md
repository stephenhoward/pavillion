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

Both instances run with `SKIP_SIGNATURES=true` unless a spec opts out, so most specs prove routing, dispatch, and side effects rather than cryptography. `signature_strict_receive.spec.ts` is the exception.

A spec that claims an activity reached a peer's inbox proves it by polling that instance's container logs for the `Inbox activity accepted` record, which is written only after validation *and* the inbox write have both succeeded. The earlier `Received inbox activity` line is emitted before validation runs, so it fires for activities the boundary then refuses with a 400 — it is evidence of arrival, never of acceptance.

Every spec lives in `tests/e2e/federation/`.

- **`webfinger.spec.ts`** — a calendar is discoverable across an instance boundary. WebFinger resolves an `acct:` resource to a profile URL, the profile returns a well-formed actor document, and an unknown account 404s rather than returning an empty actor.
- **`follow.spec.ts`** — a Follow from Beta lands in Alpha's inbox and creates a follower row, and Undo(Follow) removes it. Alpha's Accept is proven only indirectly: the assertion is that Beta's follow row reaches the accepted state, not that an Accept was seen on the wire.
- **`events.spec.ts`** — Create(Event) and Update(Event) reach a follower and change what that follower's feed shows.
- **`signed_delivery.spec.ts`** — Create, Update, and Delete(Tombstone) survive real signature generation and are accepted by a remote *calendar* inbox, and an Add editor-invite is accepted by a remote *user* inbox. The only spec that exercises both inbox routes with *calendar*-attributed activity; `cross_instance_editors.spec.ts` covers both routes for *Person*-attributed activity.
- **`signature_strict_receive.spec.ts`** — with strict receive enabled, a genuine signature verifies, an unsigned POST is refused with 400, and a forged `Signature` header with 401. The negative cases are the point of the spec.
- **`follow-backfill.spec.ts`** — history pulled from a peer's outbox after Accept(Follow) reaches the follower's feed, and replaying that history applies mid-flight activities in order: a backfilled Create+Update yields the later title, and a backfilled Announce+Undo(Announce) yields no share row at all. The only proof of the `outbox_pull` ingest path ([DEC-013](../agent-os/product/decisions/dec-013-inbox-authenticated-activity-log.md)).
- **`auto-repost.spec.ts`** — a follow policy decides whether an inbound event also lands on the follower's own calendar. Originals and reposts are covered separately because they arrive as different activities: Create carries an original, Announce carries a repost ([DEC-014](../agent-os/product/decisions/dec-014-create-original-announce-repost.md)). Also covers a policy change taking effect only on subsequent events, self-origin loop prevention, and duplicate suppression across policy toggles.
- **`unpost-sticky.spec.ts`** — after an owner unposts an auto-reposted event, the origin re-broadcasting that event does not bring it back, while the underlying event still takes the update. Update is deliberately not gated; only re-share creation is ([DEC-008](../agent-os/product/decisions/dec-008-unpost-dismissals.md)).
- **`cross_instance_editors.spec.ts`** — a user on one instance edits a calendar on another. Covers discovery of the remote Person actor, Add(editor), Create/Update/Delete signed by that Person actor and applied to the remote calendar, and Remove(editor) on revoke.
- **`note.spec.ts`** — **proof by absence.** The paired Create/Update/Delete(Note) activities Pavillion emits for Mastodon-class peers do reach a Pavillion inbox, and a Pavillion receiver skips every one of them without producing a second feed row or a Note-derived event. Notes are outbound interop only ([DEC-014](../agent-os/product/decisions/dec-014-create-original-announce-repost.md)).

## Inbound Coverage Matrix

The matrix is two-dimensional on purpose. An activity type can be fully handled by a dispatcher and still be unreachable from the network, because the type it is dispatched under and the mechanism that authenticated it are independent. That is exactly how inbound `Flag` stayed broken while looking covered: `processFlagActivity` was reachable via `local_dispatch` and rejected with a 400 via `http_signature`.

[DEC-013](../agent-os/product/decisions/dec-013-inbox-authenticated-activity-log.md) makes the ingest mechanism a first-class concept — every `ap_inbox` row records the mechanism that authenticated it in `auth_source` — so the mechanism is the second axis:

| Mechanism | How an activity arrives |
|-----------|-------------------------|
| `http_signature` | A signed POST to `/calendars/:urlname/inbox` or `/users/:username/inbox`, validated by the `addToInbox` switch in `activitypub/api/v1/server.ts`. |
| `outbox_pull` | The backfill worker GETs a followed calendar's outbox after Accept(Follow) and replays what it finds. Limited to Create, Update, Delete, Announce, and Undo. |
| `local_dispatch` | In-process outbox→inbox handoff when a recipient resolves to a calendar on the same instance. Never crosses the wire. |

### Types with an `ap_inbox` row

These are the types the calendar inbox accepts and `dispatchByType` handles.

| Activity | `http_signature` | `outbox_pull` | `local_dispatch` | `ap_inbox` row | Federation E2E proof |
|----------|:----------------:|:-------------:|:----------------:|:--------------:|----------------------|
| `Create(Event)` | yes | yes | yes | yes | `events`, `signed_delivery`; pulled form by `follow-backfill` |
| `Update(Event)` | yes | yes | yes | yes | `events`, `signed_delivery`; pulled form by `follow-backfill` |
| `Delete(Event)` | yes | yes | yes | yes | `signed_delivery`; **pulled form unproven** |
| `Follow` | yes | — | yes | yes | `follow` |
| `Accept(Follow)` | yes | — | yes | yes | `follow`, **indirect only** |
| `Announce(Event)` | yes | yes | yes | yes | `auto-repost`; pulled form by `follow-backfill` |
| `Undo(Follow)` | yes | — | yes | yes | `follow` |
| `Undo(Announce)` | yes | yes | yes | yes | `follow-backfill`, **`outbox_pull` only** |
| `Join` | yes | — | — | yes | **none** |
| `Ignore` | yes | — | yes | yes | **none** |
| `Flag` | yes | — | yes | yes | **none** |
| `Create/Update/Delete(Note)` | yes | yes | yes | yes | `note` — skipped before any side effect |

Rows that need more than a cell:

- **`Accept(Follow)` is indirect.** `follow.spec.ts` asserts that Beta's follow row reaches the accepted state, which could only happen if Alpha's Accept was ingested — but nothing asserts the Accept itself. A regression that accepted follows locally without the round-trip would still pass.
- **`Undo(Announce)` has no signed-POST proof.** `follow-backfill.spec.ts` proves the `outbox_pull` form. `unpost-sticky.spec.ts` exercises the *emitting* side — the unposting calendar has no followers in that fixture — so no spec puts an inbound Undo(Announce) through the signed POST path.
- **`Join` mutates nothing, by design.** Pavillion emits every event with `joinMode: 'none'` and keeps no attendance state, so `processJoinActivity` replies with an Ignore addressed to the sender alone and writes nothing. A future spec proves the Ignore reply, not a state change — the absence of state *is* the correct outcome.
- **`Ignore` is recorded, not acted on.** The persisted `ap_inbox` row is the entire outcome. It is a named case in `dispatchByType` rather than a fall-through, because the `default: throw` is what marks a genuinely unknown type as `processed_status: 'error'`.
- **`Join` has no `local_dispatch` cell** because Pavillion never emits a Join. `Ignore` and `Flag` do have one — both appear in the outbox routing switch and both can be addressed to a same-instance calendar.

### Paths that authenticate and act without writing a row

Two inbound paths verify the sender, act synchronously, and return 200 without ever touching `ap_inbox`. They are invisible on a type-only axis, and they are the highest-privilege activities Pavillion accepts: one writes calendar content, the other changes who is allowed to write it.

| Path | Route | Types | Handler | Federation E2E proof |
|------|-------|-------|---------|----------------------|
| Person-actor content edits | `POST /calendars/:urlname/inbox` | `Create`, `Update`, `Delete` where the actor is a Person | `processPersonActorActivity` | `cross_instance_editors` |
| Editor membership | `POST /users/:username/inbox` | `Add`, `Remove` | `processAddActivity`, `processRemoveActivity` | `signed_delivery` (Add), `cross_instance_editors` (Add and Remove) |

Both reach `logInboxActivityAccepted`, so a log poll can prove acceptance — but neither leaves a durable record. DEC-013's invariant covers the `ap_inbox` table, not the whole ingest surface, and these two paths are the surface it does not cover.

The user inbox also differs from the calendar inbox in how it treats an unrecognized type: it logs and answers 200 rather than 400. A peer cannot tell from the response whether a `Remove` was applied or silently discarded.

### Types with no inbound path

| Activity | Boundary behavior | Consequence |
|----------|-------------------|-------------|
| `Reject` | 400 at the calendar inbox; never emitted | A peer that Rejects our Follow gets a 400, and the local follow row stays pending indefinitely. Nothing clears it. |
| `Add`, `Remove` at a *calendar* inbox | 400 | Not a gap — both are addressed to Person actors and handled at the user inbox. They also have no `local_dispatch` reachability by construction: `sendEditorInvite` and `sendEditorRevoke` run only for remote user actors. |
| `Like`, `Move`, anything else | 400 | Neither emitted nor ingested. |

### The rule this matrix exists to enforce

**Any activity type reachable via `local_dispatch` but not via `http_signature` is a bug, not a gap.**

Local dispatch and the HTTP boundary share one dispatcher. A type that a same-instance handoff can reach is by definition a type Pavillion knows how to process — so refusing it from the network is a hole in federation, not an unimplemented feature. Both inbound `Flag` and inbound `Ignore` matched that shape, and both were classified as coverage gaps until the mechanism axis made them visible as defects.

The structural form of the rule: the validation switch in `addToInbox` and the switch in `dispatchByType` must list the same set of types. They agree today. When they diverge, the boundary switch is almost always the one that is wrong.

One thing this matrix cannot tell you: `local_dispatch` never crosses an instance boundary, so no federation E2E can prove it. The column records reachability, and integration tests carry the proof. Marking a `local_dispatch` cell "yes" is a statement about the code, not about the suite.

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
- `tests/e2e/federation/*.spec.ts` - the federation specs, each described in [Federation Test Scenarios](#federation-test-scenarios)
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
