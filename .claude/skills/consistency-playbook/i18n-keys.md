# i18n Key Consistency

> Version: 1.0.0
> Last Updated: 2026-02-21

Conventions for translation key naming, namespace organization, interpolation, and usage patterns.

## Key Naming

### Established Convention

Translation keys use **snake_case** throughout:

```json
{
  "add_category_button": "Add Category",
  "category_name_placeholder": "Category name",
  "confirm_delete_message": "Are you sure you want to delete this category?",
  "error_loading": "Error loading categories",
  "success_created": "Category created successfully"
}
```

**Key points:**
- All keys use snake_case: `add_category_button`, not `addCategoryButton` or `add-category-button`
- Keys are descriptive of their content and context
- Keys should be readable without seeing their values

---

## Namespace Organization

### Established Convention

Each feature area has its own JSON file, which becomes the i18n namespace:

```
src/client/locales/en/
├── calendars.json       # Calendar management translations
├── categories.json      # Category management translations
├── events.json          # Event management translations
├── system.json          # System-wide translations (navigation, modals, etc.)
└── ...

src/site/locales/en/
├── calendar.json        # Public calendar view translations
├── events.json          # Public event view translations
└── ...
```

**File name = namespace name.** `categories.json` is accessed as namespace `'categories'`.

---

## Key Hierarchy

### Established Convention

Keys are organized into nested objects by feature area:

```json
{
  "management": {
    "title": "Categories",
    "add_category_button": "Add Category",
    "loading": "Loading categories...",
    "no_categories": "No categories found",
    "no_categories_description": "Create categories to organize your events."
  },
  "assignment": {
    "title": "Assign Categories",
    "select_categories": "Select categories to assign"
  }
}
```

**Key points:**
- Top-level keys are feature sections within the namespace
- Nesting is 1-2 levels deep (namespace → section → key)
- Avoid nesting deeper than 2 levels

---

## Key Prefix Patterns

### Established Convention

Certain key prefixes indicate the purpose of the translation:

| Prefix | Purpose | Examples |
|--------|---------|----------|
| `error_` | Error messages | `error_loading`, `error_create_category`, `error_empty_name` |
| `success_` | Success confirmations | `success_created`, `success_updated`, `success_deleted` |
| `confirm_` | Confirmation dialogs | `confirm_delete_title`, `confirm_delete_message` |
| `aria_` | Accessibility labels | `aria_close_button`, `aria_select_category` |
| (no prefix) | General UI text | `title`, `loading`, `add_category_button` |

**Key points:**
- Error messages start with `error_`
- Success messages start with `success_`
- Confirmation prompts start with `confirm_`
- ARIA labels start with `aria_`
- Button/action keys end with `_button` when they label a button

---

## Action and Element Suffixes

### Established Convention

Keys that label specific UI elements include the element type as a suffix:

```json
{
  "add_category_button": "Add Category",
  "category_name_label": "Category Name",
  "category_name_placeholder": "Category name",
  "category_name_help": "Enter a descriptive name for this category",
  "search_events": "Search events",
  "select_language": "Select a Language"
}
```

| Suffix | Purpose |
|--------|---------|
| `_button` | Button labels |
| `_label` | Form field labels |
| `_placeholder` | Input placeholder text |
| `_help` | Help text / descriptions |
| `_title` | Dialog or section titles |
| `_message` | Dialog body messages |

---

## Interpolation

### Established Convention

Variable interpolation uses double curly braces with **camelCase** variable names:

```json
{
  "description_char_count": "{{remaining}} / {{max}} characters remaining",
  "welcome_message": "Welcome, {{userName}}!",
  "events_count": "{{count}} events found"
}
```

**Key points:**
- Variables use `{{variableName}}` syntax (i18next default)
- Variable names use camelCase inside the braces
- Keep interpolated strings simple — avoid complex logic in translations

---

## Component Usage

### Established Convention

```typescript
// Single namespace with key prefix
const { t } = useTranslation('categories', {
  keyPrefix: 'management',
});

// In template
{{ t('add_category_button') }}
// Resolves to: categories.management.add_category_button

// Multiple namespaces with aliased t functions
const { t } = useTranslation('calendars', { keyPrefix: 'calendar' });
const { t: tBulk } = useTranslation('calendars', { keyPrefix: 'bulk_operations' });
const { t: tSystem } = useTranslation('system');

// In template
{{ t('title') }}           // calendars.calendar.title
{{ tBulk('select_all') }}  // calendars.bulk_operations.select_all
{{ tSystem('modal.close') }} // system.modal.close
```

**Key points:**
- `useTranslation(namespace, { keyPrefix })` to scope translations
- Primary translations use `t`, additional use aliased destructuring
- Alias names reflect the keyPrefix: `tBulk` for `bulk_operations`, `tReport` for `report`

---

## Server-Side Translations

### Established Convention

Server-side i18n (for emails, backend messages) uses the same key structure:

```
src/server/locales/en/
├── email.json           # Email template translations
└── ...
```

Backend translations follow the same snake_case key naming and namespace-per-feature organization.

---

## Known Drift

- **Inconsistent prefix usage**: Some older translation files don't consistently use the `error_`, `success_`, `confirm_` prefixes. Newer files follow the prefix convention. New translations should always use the established prefixes.
- **Flat vs nested keys**: Some older files use flat key structures (`"management_title"`) while newer files use nested objects (`"management": { "title": ... }`). The nested pattern is preferred for new files.
- **Client vs site namespaces**: The client app uses `calendars.json` (plural) while the site app uses `calendar.json` (singular) for similar content. This reflects different feature scopes and is acceptable.
