# Configuration & Secrets Security

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **Hardcoded secrets**: API keys, JWT secrets, or passwords in source code
- **Insecure defaults**: Dev-only settings (e.g., signature skip, SQLite) active in production
- **Missing security headers**: No CSP, no X-Frame-Options, no HSTS
- **Exposed config endpoints**: Debug or configuration routes accessible in production
- **Credential leakage in logs**: Secrets appearing in error messages or log output
- **Permissive CORS in production**: Development CORS settings deployed to production

## Safe Patterns

### Secrets Management

All secrets must come from config files or environment variables, never source code:

```typescript
// Safe: secret from config
const jwtSecret = config.get('auth.jwtSecret');
const smtpPassword = config.get('email.smtp.password');

// Safe: config/default.yaml contains structure, production overrides via env
// auth:
//   jwtSecret: ${JWT_SECRET}  # Resolved from environment
```

### Environment-Specific Configuration

Use the config library's environment layering:

```yaml
# config/default.yaml — base config with safe defaults
federation:
  skipSignatureVerification: false  # MUST be false

# config/development.yaml — dev overrides only
federation:
  skipSignatureVerification: true  # OK for local dev

# config/test.yaml — test overrides
database:
  dialect: sqlite  # OK for tests

# Production: never use development.yaml or test.yaml
```

### Security Headers

Set security headers for all responses:

```typescript
// Safe: security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // Deprecated, CSP preferred
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'");
  next();
});
```

### Production Guards

Critical dev-only features must be guarded:

```typescript
// Safe: explicit environment check
if (process.env.NODE_ENV === 'development') {
  // Dev-only routes, debug endpoints, etc.
}

// Safe: config value with production-safe default
const skipSigVerify = config.get('federation.skipSignatureVerification');
if (skipSigVerify && process.env.NODE_ENV === 'production') {
  throw new Error('Signature verification cannot be skipped in production');
}
```

### Log Sanitization

Never log secrets or sensitive data:

```typescript
// Safe: redact sensitive fields in logs
logger.info('SMTP configured', {
  host: config.get('email.smtp.host'),
  port: config.get('email.smtp.port'),
  // NOT logging: password, auth credentials
});

// Safe: redact in error logging
logger.error('Auth failed', {
  userId: account.id,
  // NOT logging: password attempt, JWT token, session data
});
```

## Vulnerable Patterns

### Hardcoded Secrets

```typescript
// VULNERABLE: secret in source code
const JWT_SECRET = 'super-secret-key-12345';

// VULNERABLE: default secret that might reach production
const secret = config.get('auth.jwtSecret') || 'fallback-secret';
```

### Dev Config in Production

```yaml
# VULNERABLE: if this file is used in production
# config/default.yaml
federation:
  skipSignatureVerification: true  # Should never be default true

database:
  dialect: sqlite  # SQLite in production is a security/reliability risk
```

### Missing Security Headers

```typescript
// VULNERABLE: no security headers configured
app.use(express.static('public'));
// Responses sent without X-Content-Type-Options, CSP, etc.
```

### Debug Endpoints in Production

```typescript
// VULNERABLE: debug route with no env guard
app.get('/debug/config', (req, res) => {
  res.json(config); // Exposes all config including secrets
});
```

### Logging Secrets

```typescript
// VULNERABLE: logging JWT token
logger.info(`User authenticated with token: ${token}`);

// VULNERABLE: logging password on failed auth
logger.warn(`Login failed for ${email} with password ${password}`);
```

### Permissive Fallback

```typescript
// VULNERABLE: insecure fallback
const corsOrigin = config.get('cors.origin') || '*';
// If config is missing, allows all origins
```

## Known Codebase Patterns

- Config library with YAML files: `config/default.yaml`, `config/development.yaml`, `config/test.yaml`
- JWT secret from `config.get('auth.jwtSecret')`
- SMTP credentials from config
- Federation signature skip is a dev-only config option
- SQLite used for development/testing, PostgreSQL for production
- `NODE_ENV` determines active config overlay
- Flydrive storage config (S3 credentials) from config
