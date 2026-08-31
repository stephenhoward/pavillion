# Structured Logging Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **IP addresses in logs**: Raw visitor IPs logged by Pino create a deanonymization trail for public visitors
- **Email addresses in logs**: Account emails in log messages persist beyond the request lifecycle
- **Account IDs correlating activity**: Logging account UUIDs across operations creates an activity trace
- **Usernames in logs**: Logging usernames ties human-readable identity to server operations
- **Request bodies in logs**: Debug logging that dumps `req.body` can capture passwords, emails, and other PII
- **Error context with PII**: Error logging that includes the full error context may embed PII from the request

## Safe Patterns

### Rate Limiting Logging (IP Justified)

IP addresses in rate limiting middleware are justified -- they are the mechanism for enforcement. But they should be logged at `debug` level, not `info`:

```typescript
// Safe: IP logged only for rate limit enforcement, at debug level
logger.debug({ ip: req.ip, endpoint: req.path }, 'Rate limit check');
```

### Account Activity Logging

Use account ID only when necessary for debugging auth flows, never for routine operations:

```typescript
// Safe: account ID without email or username
logger.info({ accountId: account.id }, 'Calendar created');

// Safe: no account PII for routine operations
logger.info({ calendarId: calendar.id }, 'Event published');
```

### Registration/Auth Logging

Never log email addresses, even on failure:

```typescript
// Safe: log the event without the email
logger.info('Registration attempt for existing account');

// Safe: no PII in auth failure
logger.warn({ reason: 'invalid_credentials' }, 'Login failed');
```

### Error Logging

Strip PII from error context:

```typescript
// Safe: log error with entity IDs, not user PII
logger.error({ err: error, calendarId }, 'Failed to create event');

// Safe: structured error without request body
logger.error({ err: error, path: req.path, method: req.method }, 'Request failed');
```

## Leaky Patterns

### Logging Email Addresses

```typescript
// LEAKY: email address persisted in logs
logger.info({ email: req.body.email }, 'Application attempted for existing account');
// Attacker with log access can harvest email addresses

// LEAKY: email in string interpolation
logger.info(`Password reset requested for ${account.email}`);
```

### Logging Raw IP for Non-Security Purposes

```typescript
// LEAKY: IP logged for general request tracking
logger.info({ ip: req.ip, path: req.path }, 'Public API request');
// Creates a browsing history tied to IP for anonymous visitors

// LEAKY: IP in access log style
logger.info(`${req.ip} GET ${req.path}`);
```

### Logging Request Bodies

```typescript
// LEAKY: request body may contain passwords, emails
logger.debug({ body: req.body }, 'Processing request');

// LEAKY: login attempt with credentials
logger.warn({ email: req.body.email, password: req.body.password }, 'Auth failed');
```

### Logging Usernames

```typescript
// LEAKY: username ties human identity to operation
logger.info({ username: account.username, action: 'delete_event' }, 'User action');
// Account ID is sufficient for debugging; username adds PII unnecessarily
```

## Known Codebase Patterns

- Pino logger configured in `src/server/common/helper/logger.ts` with `createLogger(domain)` for child loggers
- Production mode: JSON output (PII in logs becomes structured, searchable data)
- Development mode: pretty-print to stdout
- Current known PII in logs: `email` field logged in `src/server/accounts/api/v1/applications.ts` for duplicate application detection
- IP addresses used in moderation (`ip-utils.ts`) but hashed before storage -- logging of raw IPs should follow the same principle
- Rate limit middleware in `src/server/common/middleware/rate-limit-by-ip.ts` accesses `req.ip` for enforcement
