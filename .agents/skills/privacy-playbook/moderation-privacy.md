# Moderation System Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Reporter identity exposure to reported party**: Calendar owners seeing who reported their content
- **Reporter cross-correlation**: Multiple reports from the same reporter being linkable via email or IP
- **Admin visibility of raw PII**: Administrators seeing plaintext emails and IPs instead of hashed versions
- **Forwarded report PII leakage**: Flag activities sent to remote instances containing reporter PII
- **Escalation notifications with PII**: Escalation emails containing reporter identity details
- **Blocked reporter list exposure**: Admin interface showing plaintext emails of blocked reporters
- **IP data persisting beyond retention**: IP hashes and subnets not cleaned up per retention policy

## Safe Patterns

### Reporter-to-Reported Isolation

Calendar owners should never see reporter identity:

```typescript
// Safe: report visible to calendar owner without reporter info
res.json({
  id: report.id,
  category: report.category,
  description: report.description,
  status: report.status,
  eventId: report.eventId,
  createdAt: report.createdAt,
  // NOT including: reporterEmailHash, reporterAccountId, ipHash, ipSubnet
});
```

### Admin Visibility Constraints

Admins see hashed data, not plaintext:

```typescript
// Safe: admin view uses hashed identifiers
res.json({
  ...reportDetails,
  reporterEmailHash: report.reporterEmailHash,  // Hash, not plaintext
  ipHash: report.ipHash,                         // Hash, not raw IP
  ipSubnet: report.ipSubnet,                     // /24 subnet, not full IP
  // NOT: reporterEmail: 'user@example.com'
  // NOT: reporterIp: '192.168.1.100'
});
```

### Report Forwarding Privacy

When forwarding reports (Flag activities) to remote instances:

```typescript
// Safe: forward as instance actor, strip reporter PII
const flagActivity = {
  actor: instanceActorUri,      // Instance actor, not reporter
  object: reportedContentUri,
  content: report.description,  // Report content only
  // NOT: reporter email, account ID, IP, or any identifying info
};
```

### IP Retention Compliance

Ensure IP data is cleaned per retention policy:

```typescript
// Safe: rely on IpCleanupService for data lifecycle
// ip_hash: 30-day retention
// ip_subnet: 90-day retention
// Cleanup runs as a housekeeping task
```

## Leaky Patterns

### Exposing Reporter to Calendar Owner

```typescript
// LEAKY: report response includes reporter identity
res.json({
  ...report.toObject(),
  reporterEmail: report.reporterEmail,  // Calendar owner sees who reported
});
// Creates chilling effect on reporting
```

### Raw IP in Admin Interface

```typescript
// LEAKY: admin sees raw IP, not hash
res.json({
  reporterIp: rawIp,  // Admin can geolocate reporter
});
```

### Forwarding Reporter PII to Remote Instance

```typescript
// LEAKY: flag activity includes reporter info
const flagActivity = {
  actor: reporterActorUri,      // Reporter's identity sent to remote instance
  tag: [{ name: report.reporterEmail }],  // Email sent externally
};
```

## Known Codebase Patterns

- Report entity stores `reporter_email_hash` (not plaintext), `ip_hash`, `ip_subnet`, `ip_region`
- Reporter types: `anonymous`, `authenticated`, `administrator`
- Anonymous reporters provide email for verification only; email is hashed before storage
- `IpCleanupService` handles retention with configurable days (`src/server/moderation/service/ip-cleanup.ts`)
- Report forwarding uses `forwardReport()` in moderation service -- verify reporter PII stripped
- Escalation scheduler in `src/server/moderation/service/escalation-scheduler.ts` -- verify escalation notifications don't include reporter PII
- Blocked reporter management uses email hashing (`src/server/moderation/service/email-blocking.ts`)
- Moderation analytics in `src/server/moderation/service/analytics.ts` -- verify aggregated data doesn't deanonymize
