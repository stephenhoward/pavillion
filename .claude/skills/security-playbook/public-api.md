# Public API Hardening

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **Denial of service via unrated endpoints**: Public endpoints without rate limiting can be abused
- **Information disclosure**: API responses leaking internal IDs, email addresses, or system details
- **Pagination abuse**: Requesting enormous page sizes to exhaust server resources
- **Search injection**: Unsanitized search terms causing expensive queries
- **CORS misconfiguration**: Overly permissive origins allowing cross-site data theft
- **Enumeration attacks**: Sequential IDs or predictable URLs enabling resource discovery

## Safe Patterns

### Rate Limiting

All public endpoints (especially POST, PUT, DELETE) must have rate limiting:

```typescript
// Safe: rate limiter applied to public endpoints
import rateLimit from 'express-rate-limit';

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/public/', publicLimiter);
```

### Pagination Limits

Enforce maximum page sizes server-side:

```typescript
// Safe: cap pagination values
const page = Math.max(1, parseInt(req.query.page as string) || 1);
const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 20), 100);
const offset = (page - 1) * limit;
```

### Minimal Response Data

Only include fields that public users need — no internal IDs, no private data:

```typescript
// Safe: explicit field selection for public responses
res.json({
  events: events.map(e => ({
    id: e.id,
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    location: e.location?.name,
    categories: e.categories.map(c => ({ id: c.id, name: c.name })),
    // NOT including: accountId, createdBy, internalNotes, etc.
  }))
});
```

### CORS Configuration

Restrict allowed origins to known domains:

```typescript
// Safe: explicit origin whitelist
const corsOptions = {
  origin: config.get('cors.allowedOrigins'), // Array of allowed domains
  methods: ['GET', 'OPTIONS'],              // Public API is read-only
  credentials: false,                        // No cookies for public API
};

app.use('/api/public/', cors(corsOptions));
```

### Search Term Sanitization

Limit search term length and strip dangerous characters:

```typescript
// Safe: bound search input
const search = (req.query.q as string || '').trim().substring(0, 200);
// Use parameterized queries — Sequelize handles escaping
const events = await EventEntity.findAll({
  where: { title: { [Op.iLike]: `%${search}%` } }
});
```

## Vulnerable Patterns

### No Rate Limiting

```typescript
// VULNERABLE: public POST with no rate limit
app.post('/api/public/v1/contact', async (req, res) => {
  await sendEmail(req.body.email, req.body.message);
});
// Attacker sends 10,000 requests/second
```

### Unbounded Pagination

```typescript
// VULNERABLE: user controls page size without cap
const limit = parseInt(req.query.limit as string) || 1000000;
const events = await EventEntity.findAll({ limit });
// Returns entire database in one response
```

### Leaking Internal Data

```typescript
// VULNERABLE: exposing internal fields
res.json(event.toObject());
// toObject() may include accountId, internal flags, etc.
// Always use explicit field selection for public endpoints
```

### Wildcard CORS

```typescript
// VULNERABLE: allows any origin
app.use(cors({ origin: '*', credentials: true }));
// Combined with credentials, this allows any site to make authenticated requests
```

### Exposing User Emails

```typescript
// VULNERABLE: public endpoint includes organizer email
res.json({
  event: event.toObject(),
  organizer: { name: account.name, email: account.email }
});
```

## Known Codebase Patterns

- Public API routes under `/api/public/v1/` in `src/server/public/`
- Public endpoints provide anonymous access to event data (no auth required)
- UUIDs used for all resource IDs (not sequential integers)
- Public event search and filtering implemented with URL parameter support
- Rate limiting configured in the application — verify coverage for all public POST/PUT/DELETE routes
- CORS configuration managed via config files
