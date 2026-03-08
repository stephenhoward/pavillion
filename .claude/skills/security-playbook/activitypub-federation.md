# ActivityPub Federation Security

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **SSRF (Server-Side Request Forgery)**: Outgoing HTTP requests to attacker-controlled or internal URLs during federation
- **HTTP signature bypass**: Accepting unsigned or improperly verified requests
- **Actor/signer mismatch**: Activity claims to be from actor A but is signed by actor B
- **Replay attacks**: Re-submitting a valid signed request to perform duplicate actions
- **Object URI domain mismatch**: Activity references objects on a different domain than the actor
- **Blocked instance bypass**: Processing activities from instances that should be blocked
- **Inbox flooding**: Overwhelming an instance with federation requests
- **Malicious content injection**: Untrusted federated content containing scripts or exploits

## Safe Patterns

### HTTP Signature Verification

All incoming federation requests must have verified HTTP signatures:

```typescript
// Safe: signature verified before processing
// The activitypub-express library handles this, but verify it's configured
// Signature verification should happen in middleware before inbox processing
```

### Actor/Signer Match

The actor in the activity must match the key used to sign the request:

```typescript
// Safe: verify the signer matches the actor
const activity = req.body;
const signer = req.signature?.keyId; // From HTTP signature
const actorId = activity.actor;

// The signing key's owner must match the activity's actor
if (!signer?.startsWith(actorId)) {
  // Reject: signed by different actor
}
```

### Replay Prevention

Check the `Date` header freshness to prevent replay attacks:

```typescript
// Safe: reject requests with stale Date headers
const requestDate = new Date(req.headers.date);
const now = new Date();
const maxAge = 5 * 60 * 1000; // 5 minutes

if (Math.abs(now.getTime() - requestDate.getTime()) > maxAge) {
  // Reject: request too old, possible replay
}
```

### Object URI Domain Verification

Objects referenced in activities should come from the actor's domain:

```typescript
// Safe: verify object domain matches actor domain
const actorDomain = new URL(activity.actor).hostname;
const objectId = typeof activity.object === 'string'
  ? activity.object
  : activity.object?.id;

if (objectId) {
  const objectDomain = new URL(objectId).hostname;
  if (objectDomain !== actorDomain) {
    // Flag: object from different domain than actor
  }
}
```

### Blocked Instance Filtering

Check blocked instances before processing any incoming activity:

```typescript
// Safe: filter blocked instances early in the pipeline
const actorDomain = new URL(activity.actor).hostname;
if (await isBlockedInstance(actorDomain)) {
  // Silently discard — don't reveal blocking
  return;
}
```

### SSRF Prevention for Outgoing Requests

When fetching remote resources during federation, validate URLs:

```typescript
// Safe: validate URL before fetching
function isSafeUrl(url: string): boolean {
  const parsed = new URL(url);
  // Must be HTTPS
  if (parsed.protocol !== 'https:') return false;
  // Block internal networks
  if (parsed.hostname === 'localhost') return false;
  if (parsed.hostname.startsWith('127.')) return false;
  if (parsed.hostname.startsWith('10.')) return false;
  if (parsed.hostname.startsWith('192.168.')) return false;
  if (parsed.hostname.startsWith('172.')) return false;
  if (parsed.hostname === '0.0.0.0') return false;
  return true;
}
```

## Vulnerable Patterns

### No Signature Verification

```typescript
// VULNERABLE: processing inbox without signature check
app.post('/inbox', async (req, res) => {
  await processActivity(req.body); // No signature verification
});
```

### Fetching Arbitrary URLs

```typescript
// VULNERABLE: no URL validation before fetch
const actor = await fetch(activity.actor).then(r => r.json());
// Attacker sets actor to http://169.254.169.254/metadata (cloud metadata)
// or http://localhost:5432 (internal database port)
```

### Trusting Activity Content

```typescript
// VULNERABLE: using federated content without sanitization
const eventTitle = activity.object.name; // Could contain <script> tags
```

### No Date Freshness Check

```typescript
// VULNERABLE: accepting requests with any Date header
// An attacker can replay a valid signed request indefinitely
```

### Skip Signature in Dev Mode Leaking to Production

```typescript
// VULNERABLE: dev-only bypass that could reach production
if (config.get('federation.skipSignatureVerification')) {
  // This config should never be true in production
}
```

## Known Codebase Patterns

- `activitypub-express` library handles core federation protocol in `src/server/activitypub/`
- HTTP signatures use `http-signature` package
- Federation trust levels and auto-repost policies are configurable per instance
- Blocked instance management exists in the moderation domain
- ActivityPub actors have public/private key pairs for signing
- Structured logging captures rejected inbox activities (recent implementation)
- Federation signature verification skip exists as a dev config option — ensure it's disabled in production
