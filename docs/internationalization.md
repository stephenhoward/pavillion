# Internationalization (i18n)

Pavillion supports multiple languages for its user interface. This document explains how to add new language translations.

## Overview

The application uses [i18next](https://www.i18next.com/) for internationalization. Translation files are JSON files organized by language code and namespace.

## Language Registration

Available languages are defined in a single source of truth:

```
src/common/i18n/languages.ts
```

This file exports:
- `AVAILABLE_LANGUAGES` - Array of supported languages with codes and native names
- `DEFAULT_LANGUAGE_CODE` - The fallback language (English)
- `isValidLanguageCode()` - Validation helper

## Adding a New Language

### Step 1: Register the Language

Add the new language to `src/common/i18n/languages.ts`:

```typescript
export const AVAILABLE_LANGUAGES: Language[] = [
  { code: 'en', nativeName: 'English' },
  { code: 'es', nativeName: 'Español' },  // Add your language here
];
```

Use the ISO 639-1 two-letter language code and the language name in its native script.

### Step 2: Create Translation Files

Create translation files for each of the three apps:

#### Client App (authenticated users)

Create a new directory and copy all English files:

```bash
mkdir src/client/locales/{code}
cp src/client/locales/en/*.json src/client/locales/{code}/
```

Translation files to create:
- `admin.json` - Admin interface
- `authentication.json` - Login and authentication
- `calendars.json` - Calendar management
- `categories.json` - Event categories
- `event_editor.json` - Event creation/editing
- `feed.json` - Activity feed
- `inbox.json` - Notifications inbox
- `media.json` - Media uploads
- `profile.json` - User profile
- `registration.json` - User registration
- `setup.json` - Initial setup
- `system.json` - System-wide strings

#### Site App (public calendar)

```bash
mkdir src/site/locales/{code}
cp src/site/locales/en/*.json src/site/locales/{code}/
```

Translation files to create:
- `system.json` - Public site strings

#### Server (email templates)

```bash
mkdir src/server/locales/{code}
cp src/server/locales/en/*.json src/server/locales/{code}/
```

Translation files to create:
- `account_invitation_email.json`
- `account_registration_email.json`
- `application_accepted_email.json`
- `application_acknowledgment_email.json`
- `application_rejected_email.json`
- `editor_invitation_email.json`
- `editor_notification_email.json`
- `password_reset_email.json`

### Step 3: Update Locale Initialization

Update the locale service files to load the new translations.

#### Client App

Edit `src/client/service/locale.ts`:

```typescript
// Import new language resources
import esSystem from '@/client/locales/es/system.json';
import esAuthentication from '@/client/locales/es/authentication.json';
// ... import all other namespaces

// Add to resources object
resources: {
  en: { /* existing */ },
  es: {
    system: esSystem,
    authentication: esAuthentication,
    // ... all other namespaces
  },
}
```

#### Site App

Edit `src/site/service/locale.ts` similarly.

### Step 4: Test the Translations

1. Run the development server: `npm run dev`
2. Change your browser's language preference to the new language
3. Verify all UI strings are translated correctly
4. Check for missing translations in the browser console (debug mode)

## Translation Guidelines

### JSON Format

Translation files use a flat or nested JSON structure:

```json
{
  "greeting": "Hello",
  "messages": {
    "welcome": "Welcome to Pavillion",
    "goodbye": "Goodbye"
  }
}
```

### Interpolation

Variables are inserted using double curly braces:

```json
{
  "welcome_user": "Welcome, {{name}}!"
}
```

### Pluralization

Use i18next plural suffixes:

```json
{
  "event_count": "{{count}} event",
  "event_count_plural": "{{count}} events"
}
```

### Best Practices

- Keep translations contextually accurate, not literal
- Maintain consistent terminology across namespaces
- Consider text expansion (some languages are longer than English)
- Test with right-to-left (RTL) languages if applicable
- Include translator comments for ambiguous strings

## File Structure Summary

```
src/
├── common/
│   └── i18n/
│       └── languages.ts          # Language registry
├── client/
│   ├── locales/
│   │   ├── en/                   # English translations
│   │   │   ├── admin.json
│   │   │   ├── authentication.json
│   │   │   └── ...
│   │   └── {code}/               # New language
│   └── service/
│       └── locale.ts             # Client i18n initialization
├── site/
│   ├── locales/
│   │   ├── en/
│   │   │   └── system.json
│   │   └── {code}/
│   └── service/
│       └── locale.ts             # Site i18n initialization
└── server/
    └── locales/
        ├── en/
        │   ├── account_invitation_email.json
        │   └── ...
        └── {code}/
```

## Questions?

If you have questions about translations or need help, please open an issue on the GitHub repository.
