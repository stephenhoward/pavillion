# Data Storage Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Plaintext IP storage**: Storing raw IP addresses instead of hashed or anonymized versions
- **Email address retention**: Keeping email addresses longer than necessary for their purpose
- **Missing data cleanup**: PII stored without a defined retention policy or cleanup mechanism
- **Over-collection**: Storing PII fields that aren't needed for the feature's operation
- **Backup PII**: Database backups containing PII without encryption or access controls
- **Seed data with real PII**: Development seed data using real email addresses or identifiable information

## Safe Patterns

### IP Address Hashing

Always hash IP addresses before storage using the existing `hashIp()` utility:

```typescript
// Safe: IP hashed with HMAC-SHA256 before storage
import { hashIp, extractSubnet } from '@/server/moderation/service/ip-utils';

const hashedIp = hashIp(extractIpFromRequest(req));
const subnet = extractSubnet(extractIpFromRequest(req));

await ReportEntity.create({
  ip_hash: hashedIp,        // Hashed, not raw
  ip_subnet: subnet,        // /24 subnet only, not full IP
});
```

### IP Data Retention with Cleanup

Use the existing cleanup service with defined retention policies:

```typescript
// Safe: IP data has time-limited retention
// ip_hash cleared after 30 days
// ip_subnet cleared after 90 days
// Managed by IpCleanupService in src/server/moderation/service/ip-cleanup.ts
```

### Email Hashing for Tracking

When emails need to be tracked (e.g., blocked reporters) but not displayed:

```typescript
// Safe: email hashed for comparison, not stored in plaintext
const emailHash = hashEmail(email);
await BlockedReporterEntity.create({
  email_hash: emailHash,   // Can check "is this email blocked?" without storing the email
});
```

### Minimal Entity Fields

Only include PII fields that the feature genuinely requires:

```typescript
// Safe: entity stores only what's needed
@Table({ tableName: 'calendar_editor' })
class CalendarEditorEntity extends Model {
  declare calendar_id: string;
  declare account_id: string;    // Needed: to identify the editor
  declare role: string;
  // NOT storing: editor's email, display name, IP, etc.
}
```

## Leaky Patterns

### Raw IP Storage

```typescript
// LEAKY: raw IP stored in database
await ReportEntity.create({
  reporter_ip: req.ip,  // Raw IP persisted indefinitely
});
```

### No Retention Policy

```typescript
// LEAKY: PII stored without cleanup mechanism
await LoginAttemptEntity.create({
  email: req.body.email,
  ip: req.ip,
  timestamp: new Date(),
  // No cleanup job exists for this table
});
```

### Over-Collection

```typescript
// LEAKY: storing user agent string unnecessarily
await EventViewEntity.create({
  eventId: event.id,
  userAgent: req.headers['user-agent'],  // Not needed for any feature
  ip: req.ip,                             // Not needed for view counting
  referrer: req.headers['referer'],       // Not needed
});
```

### Seed Data with Real PII

```yaml
# LEAKY: development seed data with real-looking emails
accounts:
  - email: john.smith@gmail.com    # Use clearly fake data
  - email: jane.doe@company.com
```

## Known Codebase Patterns

- IP hashing via `hashIp()` in `src/server/moderation/service/ip-utils.ts` using HMAC-SHA256 with configurable salt
- IP subnet extraction via `extractSubnet()` for /24 anonymization
- IP cleanup service in `src/server/moderation/service/ip-cleanup.ts` with 30-day hash retention and 90-day subnet retention
- Report entity stores `ip_hash` and `ip_subnet`, not raw IP (good)
- Reporter email stored as `reporter_email_hash` in report entity, not plaintext (good)
- Blocked reporter entity uses email hashing
- Backup system in housekeeping domain -- verify backups are encrypted
