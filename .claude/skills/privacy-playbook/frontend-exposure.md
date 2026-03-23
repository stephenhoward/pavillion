# Frontend Data Exposure

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Cookies for unauthenticated visitors**: Any cookie set for public site visitors creates a tracking mechanism
- **localStorage/sessionStorage PII**: Storing account data in browser storage that persists beyond the session
- **API responses in DevTools**: Public API responses visible in Network tab exposing account IDs or emails
- **Analytics or tracking scripts**: Any third-party tracking on public pages violates the privacy-first mission
- **Fingerprinting vectors**: Collecting browser capabilities, screen resolution, or other fingerprinting data
- **Prefetch/preload leaking**: Fetching authenticated API endpoints from public pages

## Safe Patterns

### No Cookies for Public Visitors

Public site visitors should receive zero cookies:

```typescript
// Safe: public site app has no cookie-setting middleware
// The site app should not initialize passport, sessions, or any cookie-based auth

// Safe: language preference via URL prefix, not cookie
// /en/view/mycalendar -- language in URL, not stored in cookie
```

### Authenticated App Storage

The client app (authenticated) may use localStorage for JWT tokens only:

```typescript
// Safe: localStorage used only for auth token in client app
localStorage.setItem('jwt_token', token);

// Safe: no PII stored in localStorage beyond the token
// Account details fetched fresh from API, not cached in storage
```

### Public Site Zero-Tracking

```typescript
// Safe: no analytics, no tracking pixels, no third-party scripts
// Public site pages should have no external JavaScript dependencies
// No Google Analytics, no Facebook Pixel, no Hotjar, nothing
```

### Language Detection Without Storage

```typescript
// Safe: language detected from URL prefix or Accept-Language header
// No cookie set to remember preference for anonymous visitors
const language = getLanguageFromUrl(req.path) || detectFromHeader(req.headers['accept-language']);
```

## Leaky Patterns

### Setting Cookies for Anonymous Visitors

```typescript
// LEAKY: language preference cookie for unauthenticated users
res.cookie('preferred_language', lang, { maxAge: 30 * 24 * 60 * 60 * 1000 });
// Creates a persistent identifier for anonymous visitors
```

### Storing Account Data in Browser Storage

```typescript
// LEAKY: caching account details in localStorage
localStorage.setItem('account', JSON.stringify(account.toObject()));
// Email, username persisted in browser even after logout
```

### Third-Party Scripts on Public Pages

```html
<!-- LEAKY: Google Analytics on public event pages -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
<!-- Violates privacy-first mission -- tracks anonymous visitors -->
```

### Public API Fetching Account Data

```typescript
// LEAKY: public page fetches authenticated endpoint
fetch('/api/v1/account')  // From public site code
// Should never happen -- public site has no concept of logged-in users
```

## Known Codebase Patterns

- Client app uses `localStorage` for authentication (`src/client/app.ts`, `src/client/service/authn.ts`)
- Site app initializes authentication with `localStorage` (`src/site/app.ts`) -- verify this doesn't set cookies for public visitors
- Locale middleware reads `cookie` header for language preference (`src/server/common/middleware/locale.ts`) -- verify no cookie is SET for unauthenticated requests
- No analytics or tracking libraries detected in `package.json` (good)
- Language settings test explicitly verifies no localStorage writes for language (`settings-language-switcher.test.ts`) (good)
- Widget SDK runs in iframe with cross-origin restrictions
