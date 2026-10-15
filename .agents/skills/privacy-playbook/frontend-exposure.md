# Frontend Data Exposure

> Version: 1.0.0
> Last Updated: 2026-10-14

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
// /es/mycalendar -- language in URL, not stored in cookie
```

### Authenticated App Storage

The client app (authenticated) may use localStorage for the JWT token and for non-PII session state that is cleared with the token (the current calendar's ID, see Known Codebase Patterns):

```typescript
// Safe: auth token in client app
localStorage.setItem('jwt', token);
localStorage.setItem('jw_token', JSON.stringify(claims)); // decoded JWT claims

// Safe: bare calendar UUID, removed whenever the token is removed
localStorage.setItem('current_calendar_id', calendarId);

// Safe: no PII stored in localStorage
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
- `localStorage['current_calendar_id']` — the client app's current calendar, a bare calendar UUID, no PII. Key and read/write helpers live in the import-free `src/client/service/current-calendar-storage.ts`. Written by `calendarStore.setSelectedCalendar`, removed by `Authentication._unset_token()` on every token-removal path. Only the client app reads it. The site app bundles the same `Authentication` service, so its `_unset_token()` can remove the key too — harmless, it never reads it; the widget never touches it. The calendar store tags its list with the account it was loaded for, and `CalendarService.ensureCalendarsLoaded` resets the list and the persisted key when the signed-in account differs (including a re-login as another account through the session-expired modal). An ID that survives anyway — e.g. read at store creation — is still validated by `resolveCurrentCalendar` against the signed-in account's calendar list before use.
- Site app initializes authentication with `localStorage` (`src/site/app.ts`) -- verify this doesn't set cookies for public visitors
- Locale middleware reads `cookie` header for language preference (`src/server/common/middleware/locale.ts`) -- verify no cookie is SET for unauthenticated requests
- No analytics or tracking libraries detected in `package.json` (good)
- Language settings test explicitly verifies no localStorage writes for language (`settings-language-switcher.test.ts`) (good)
- Widget SDK runs in iframe with cross-origin restrictions
