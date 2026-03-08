# Template Injection & XSS Prevention

> Version: 1.0.0
> Last Updated: 2026-02-13

## Threats

- **Stored XSS via `v-html`**: Rendering unsanitized user content as raw HTML in Vue templates
- **XSS via Handlebars triple-brace**: `{{{value}}}` renders unescaped HTML in email templates
- **Translation key injection**: User input used as translation keys to access unintended strings
- **Federated content XSS**: ActivityPub content from other instances containing malicious HTML/scripts
- **Event description XSS**: Rich text in event descriptions containing script tags

## Safe Patterns

### Vue Template Output

Vue's default `{{ }}` interpolation auto-escapes HTML. Always prefer this:

```vue
<!-- Safe: auto-escaped by Vue -->
<h1>{{ event.title }}</h1>
<p>{{ event.description }}</p>

<!-- Safe: bound attributes are also escaped -->
<img :alt="event.title" :src="event.imageUrl">
```

### When `v-html` Is Necessary

If `v-html` is absolutely required (e.g., for rich text rendering), sanitize first:

```typescript
// Safe: sanitize before rendering
import DOMPurify from 'dompurify';

const sanitizedHtml = DOMPurify.sanitize(rawHtml, {
  ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  ALLOWED_ATTR: ['href', 'target', 'rel'],
});
```

```vue
<!-- Safe: only after sanitization -->
<div v-html="sanitizedDescription"></div>
```

### Handlebars Email Templates

Always use double-brace `{{value}}` which auto-escapes:

```handlebars
<!-- Safe: auto-escaped -->
<p>Hello, {{userName}}</p>
<p>Event: {{eventTitle}}</p>

<!-- Safe: URLs in attributes -->
<a href="{{resetUrl}}">Reset your password</a>
```

### Translation Keys

Never construct translation keys from user input:

```typescript
// Safe: static translation keys
const message = t('error.calendar.not_found');

// Safe: parameterized translations
const message = t('welcome.greeting', { name: userName });
```

### Federated Content Handling

Always sanitize content received from federation before display:

```typescript
// Safe: sanitize federated content before storing or displaying
function sanitizeFederatedContent(content: string): string {
  // Strip all HTML tags from federated text content
  return content.replace(/<[^>]*>/g, '');
  // Or use a sanitization library for rich text
}
```

## Vulnerable Patterns

### Raw User Data in `v-html`

```vue
<!-- VULNERABLE: unsanitized user content -->
<div v-html="event.description"></div>
<!-- If description contains <script>alert('xss')</script>, it executes -->

<!-- VULNERABLE: federated content directly rendered -->
<div v-html="federatedEvent.summary"></div>
```

### Triple-Brace in Handlebars

```handlebars
<!-- VULNERABLE: unescaped output -->
<p>{{{userProvidedHtml}}}</p>
<!-- Any HTML/JS in the value will render -->

<!-- VULNERABLE: user name could contain HTML -->
<p>Hello, {{{userName}}}</p>
```

### Dynamic Translation Keys

```typescript
// VULNERABLE: user input as translation key
const key = req.body.errorType;
const message = t(key); // User could access any translation string
```

### Unescaped URL Parameters in Templates

```vue
<!-- VULNERABLE: URL param rendered without escaping -->
<div v-html="'Search results for: ' + route.query.q"></div>
<!-- Attacker: ?q=<img src=x onerror=alert(1)> -->
```

## Known Codebase Patterns

- Vue 3 with `<script setup>` pattern — default `{{ }}` is safe
- Handlebars used for email templates in `src/server/common/` (email rendering)
- i18next provides translation with parameterized values
- Event descriptions and multilingual content stored as text
- Federated content arrives via ActivityPub — must be treated as untrusted
- Check any usage of `v-html` in `src/client/` and `src/site/` directories
- Check any usage of `{{{` in email template files (`.hbs` or `.handlebars`)
