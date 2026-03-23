# Error Response Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Account existence disclosure**: Different error messages for "account not found" vs "wrong password" reveal whether an account exists
- **Internal IDs in errors**: Error responses including database IDs, entity references, or internal paths
- **PII in validation errors**: Validation error messages that echo back the user's input including email addresses
- **Stack traces with PII**: Production error responses including stack traces that contain PII from request context
- **Detailed moderation errors**: Error responses revealing who reported content or moderation status details

## Safe Patterns

### Account Enumeration Prevention

Return identical responses regardless of whether an account exists:

```typescript
// Safe: same message for all auth failure cases
res.status(401).json({ error: 'Invalid credentials' });
// Never: "Account not found" vs "Wrong password"
```

### Validation Error Privacy

Don't echo back PII in validation messages:

```typescript
// Safe: reference the field name, don't echo the value
res.status(400).json({
  error: 'Validation failed',
  fields: { email: 'Invalid email format' },
  // NOT: { email: 'john@invalid is not a valid email' }
});
```

### Generic Error Responses

```typescript
// Safe: generic error without internal details
res.status(500).json({ error: 'Internal server error' });
// NOT: { error: error.message, stack: error.stack, query: error.sql }
```

### Moderation Error Privacy

```typescript
// Safe: don't reveal reporter identity in error responses
res.status(409).json({ error: 'This content has already been reported' });
// NOT: { error: 'Already reported by user@email.com' }
```

## Leaky Patterns

### Account Existence Disclosure

```typescript
// LEAKY: different messages reveal account existence
if (!account) {
  res.status(404).json({ error: 'Account not found' });
} else if (!passwordMatch) {
  res.status(401).json({ error: 'Incorrect password' });
}
// Attacker learns which emails have accounts
```

### Echoing PII in Errors

```typescript
// LEAKY: echoing email back in error response
res.status(400).json({
  error: `Email ${req.body.email} is already registered`
});
```

### Internal Details in Production Errors

```typescript
// LEAKY: stack trace with request context
res.status(500).json({
  error: error.message,
  stack: error.stack,  // May contain file paths, query params with PII
});
```

## Known Codebase Patterns

- Account enumeration prevention implemented for login and password reset flows (good)
- Error serialization patterns documented in `backend-error-serialization` skill
- `ExpressHelper.sendValidationError()` handles structured validation errors -- verify no PII echoing
- Public API error responses use `{ error, errorName }` shape without internal details (good)
