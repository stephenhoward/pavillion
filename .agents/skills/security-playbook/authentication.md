# Authentication & Authorization Security

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **JWT algorithm confusion**: Accepting `none` or HMAC when RSA is expected
- **JWT secret weakness**: Hardcoded or weak signing secrets
- **Missing token expiration**: Tokens that never expire allow indefinite access
- **Password storage weakness**: Weak hashing algorithms or missing salt
- **Account enumeration**: Different responses for "user exists" vs "user doesn't exist"
- **Reset code abuse**: Predictable reset codes, no expiration, no rate limiting
- **IDOR (Insecure Direct Object Reference)**: Accessing resources by guessing IDs without ownership verification
- **Missing auth middleware**: Endpoints that should require login but don't enforce it
- **Privilege escalation**: Users accessing admin or other-user resources

## Safe Patterns

### JWT Token Creation

Always specify algorithm explicitly and set expiration:

```typescript
// Safe: explicit algorithm and expiration
import jwt from 'jsonwebtoken';

const token = jwt.sign(
  { sub: account.id },  // Minimal payload
  config.get('auth.jwtSecret'),
  { algorithm: 'HS256', expiresIn: '24h' }
);
```

### JWT Verification

Always specify allowed algorithms:

```typescript
// Safe: explicit algorithm whitelist
jwt.verify(token, secret, { algorithms: ['HS256'] });
```

### Password Hashing

The codebase uses `scryptSync` with unique salts:

```typescript
import { scryptSync, randomBytes } from 'crypto';

// Safe: scrypt with random salt
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
const stored = `${salt}:${hash}`;
```

### Account Enumeration Prevention

Return identical responses regardless of whether an account exists:

```typescript
// Safe: same response for all cases
async resetPassword(email: string): Promise<void> {
  const account = await this.findByEmail(email);
  if (!account) {
    return; // Don't reveal that the account doesn't exist
  }
  // Send reset email
}
// Same response message: "If an account exists, we've sent a reset email"
```

### IDOR Prevention — Ownership Checks

Always verify the requesting user owns or has permission to access the resource:

```typescript
// Safe: ownership verified in service layer
async getCalendar(account: Account, calendarId: string): Promise<Calendar> {
  const calendar = await this.findCalendar(calendarId);
  if (!calendar) {
    throw new CalendarNotFoundError();
  }
  if (calendar.accountId !== account.id) {
    // Check if user is an editor
    const isEditor = await this.isEditor(account.id, calendarId);
    if (!isEditor) {
      throw new NotAuthorizedError();
    }
  }
  return calendar;
}
```

### Route Authentication

Use `loggedInOnly` middleware on all authenticated endpoints:

```typescript
// Safe: auth middleware applied
app.get('/api/v1/calendars', loggedInOnly, async (req, res) => {
  const account = req.user as Account;
  // ...
});
```

## Vulnerable Patterns

### Missing Algorithm Specification

```typescript
// VULNERABLE: accepts any algorithm including "none"
jwt.verify(token, secret);

// VULNERABLE: no algorithm on sign
jwt.sign(payload, secret);
```

### Hardcoded JWT Secret

```typescript
// VULNERABLE: secret in source code
const token = jwt.sign(payload, 'my-secret-key');
```

### JWT Payload Bloat

```typescript
// VULNERABLE: sensitive data in JWT payload
jwt.sign({
  sub: account.id,
  email: account.email,
  passwordHash: account.passwordHash,  // Never include this
  role: account.role
}, secret);
```

### Missing IDOR Check

```typescript
// VULNERABLE: no ownership verification
async deleteEvent(req: Request, res: Response) {
  const eventId = req.params.id;
  await this.service.deleteEvent(eventId);  // Who owns this event?
  res.status(204).send();
}
```

### Missing Auth Middleware

```typescript
// VULNERABLE: no loggedInOnly middleware
app.post('/api/v1/calendars', async (req, res) => {
  // Anyone can create calendars
});
```

### Account Enumeration

```typescript
// VULNERABLE: different messages reveal account existence
if (!account) {
  res.status(404).json({ error: 'Account not found' });
} else if (!passwordMatch) {
  res.status(401).json({ error: 'Incorrect password' });
}
```

## Known Codebase Patterns

- Passport.js handles JWT strategy in `src/server/authentication/`
- `loggedInOnly` middleware enforces authentication on protected routes
- Password hashing uses `scryptSync` from Node.js crypto
- Password reset codes have expiration (check `src/server/authentication/service/`)
- Account enumeration prevention implemented for registration and password reset flows
- Editor permissions system uses `CalendarEditorEntity` for multi-user calendar access
- JWT secret loaded from config: `config.get('auth.jwtSecret')`
