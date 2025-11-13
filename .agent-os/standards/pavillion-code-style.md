# Pavillion Code Style Guide

> Version: 1.0.0
> Last Updated: 2025-07-29
> Scope: Pavillion federated events calendar system

## Context

This file provides code style guidelines specifically for the Pavillion project. These rules extend the global .agent-os code style standards with Pavillion-specific formatting, naming conventions, and patterns for Vue.js 3, TypeScript, SCSS, and Express.js development.

## General Formatting

### Indentation
- Use **2 spaces** for indentation (never tabs) - matches Vue.js and TypeScript conventions
- Maintain consistent indentation in all file types (.ts, .vue, .scss, .json)
- Align object properties and method parameters vertically for readability

### File Organization
- Use kebab-case for file names: `calendar-service.ts`, `edit-event.vue`
- Group related files in domain-specific directories
- Maintain consistent directory structure across domains

## TypeScript Conventions

### Naming Patterns
- **Classes**: PascalCase (e.g., `CalendarService`, `EventEntity`, `CalendarContent`)
- **Interfaces**: PascalCase with "Interface" suffix (e.g., `CalendarInterface`, `AccountsInterface`)
- **Variables and Methods**: camelCase (e.g., `urlName`, `getUserCalendars`, `toModel`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRY_COUNT`, `DEFAULT_LANGUAGE`)
- **File names**: kebab-case (e.g., `calendar-service.ts`, `event-category.ts`)

### Import Organization
Follow this import order with blank lines between groups:

```typescript
// 1. External dependencies
import express, { Request, Response, Application } from 'express';
import { v4 as uuidv4 } from 'uuid';
import sinon from 'sinon';

// 2. Internal domain models and exceptions (common)
import { Calendar, CalendarContent } from '@/common/model/calendar';
import { Account } from '@/common/model/account';
import { UrlNameAlreadyExistsError, InvalidUrlNameError } from '@/common/exceptions/calendar';

// 3. Interfaces from other domains
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';

// 4. Libraries specific to the current domain
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { CalendarEditorEntity } from '@/server/calendar/entity/calendar_editor';
```

### Type Definitions
```typescript
// Use explicit typing for better code clarity
declare id: string;
declare account_id: string;
declare languages: string;

// Function signatures with clear parameter types
async setUrlName(account: Account, calendar: Calendar, urlName: string): Promise<boolean>

// Generic types for translated models
class Calendar extends TranslatedModel<CalendarContent>
```

### Method Documentation
Use JSDoc comments for public methods (without type signatures):

```typescript
/**
 * Creates new content for a specified language.
 *
 * @param language - The language code to create content for
 * @returns New content instance for the specified language
 * @protected
 */
protected createContent(language: string): CalendarContent {
  return new CalendarContent(language);
}
```

## Vue.js 3 Conventions

### Component Structure
Organize Vue components in this order:

```vue
<script setup>
// 1. Imports
import { reactive } from 'vue';
import { useTranslation } from 'i18next-vue';
import loggedInNavigation from './loggedInNavigation.vue';

// 2. Composables
const { t } = useTranslation('system');

// 3. Reactive state
const state = reactive({
  userInfo: {
    currentEvent: null,
  },
});
</script>

<template>
  <!-- HTML structure -->
</template>

<style scoped lang="scss">
/* Component styles */
</style>
```

### Component Naming
- **File names**: kebab-case (e.g., `edit-event.vue`, `logged-in-navigation.vue`)
- **Component registration**: PascalCase in imports, kebab-case in templates
- **Props and events**: camelCase in script, kebab-case in templates

### Template Structure
```vue
<template>
  <div class="root">
    <a href="#main" 
       class="skip-link">
      {{ t("navigation.skip_to_content") }}
    </a>
    <loggedInNavigation 
      @open-event="(e) => state.currentEvent = e" />
    <div id="main">
      <RouterView 
        @open-event="(e) => state.currentEvent = e"/>
    </div>
  </div>
</template>
```

## SCSS Styling Conventions
**Always** nest scss declarations to match the template markup.

### Variable Organization
Use centralized SCSS variables in `mixins.scss`:

```scss
// Color system
$light-mode-background: #a2a9c1;
$light-mode-text: #000;
$dark-mode-background: #33333a;
$dark-mode-text: #eee;

// Typography
$font-thin: 100;
$font-light: 300;
$font-regular: 400;
$font-medium: 500;
$font-bold: 600;

// Layout
$main-area-menu-gutter: 40px;
$form-input-border-radius: 20px;
```

### Mixin Usage
```scss
@use '../assets/mixins' as *;

// Use mixins for common patterns
@include empty-screen;

// Use variables consistently
color: $light-mode-text;
font-weight: $font-medium;
border-radius: $form-input-border-radius;
```

### Component Styling
```scss
<style scoped lang="scss">
@use '../assets/mixins' as *;

div.root {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  height: 100%;

  a.skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: #555;
    color: white;
    padding: 10px;
    z-index: 1000;
    
    &:focus {
      top: 0;
    }
  }
}
</style>
```

### Dark Mode Support
Always implement both light and dark mode variants:

```scss
button.primary {
  background: $light-mode-button-background;
  color: $light-mode-text;
  
  @media (prefers-color-scheme: dark) {
    background: $dark-mode-button-background;
    color: $dark-mode-text;
  }
}
```

## Express.js API Conventions

### Route Handler Structure
```typescript
export default class CalendarAPI {
  static install(app: Application, internalAPI: CalendarInterface): void {
    app.use(express.json());

    let eventsRoutes = new EventRoutes(internalAPI);
    eventsRoutes.installHandlers(app, '/api/v1');
    let calendarRoutes = new CalendarRoutes(internalAPI);
    calendarRoutes.installHandlers(app, '/api/v1');
  }
}
```

### API Handler Pattern
```typescript
async listCalendars(req: Request, res: Response) {
  const account = req.user as Account;

  if (!account) {
    res.status(400).json({
      "error": "missing account for calendars. Not logged in?",
    });
    return;
  }

  const calendarsWithRelationship = await this.service.editableCalendarsWithRoleForUser(account);
  res.json(calendarsWithRelationship.map((calendarInfo) => ({
    ...calendarInfo.calendar.toObject(),
    userRelationship: calendarInfo.role,
  })));
}
```

## Database Entity Patterns

### Sequelize Entity Structure
```typescript
@Table({ tableName: 'calendar' })
class CalendarEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID })
  declare account_id: string;

  @Column({ type: DataType.STRING })
  declare url_name: string;

  toModel(): Calendar {
    let calendar = new Calendar(this.id, this.url_name);
    // Convert entity data to domain model
    return calendar;
  }

  static fromModel(calendar: Calendar): CalendarEntity {
    return CalendarEntity.build({
      id: calendar.id,
      url_name: calendar.urlName,
      // Convert domain model to entity data
    });
  }
}
```

## Testing Conventions

### Test File Structure
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

describe('CalendarService.setUrlName', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return false if urlName is invalid', async () => {
    // Test implementation
  });
});
```

### Test Data Patterns
```typescript
// Use descriptive test data
const tests: [string, boolean][] = [
  ['_noleadunderscore', false],
  ['thisisamuchtoolongusername', false],
  ['no spaces allowed', false],
  ['legalusername', true],
];

for (let test of tests) {
  expect(service.isValidUrlName(test[0])).toBe(test[1]);
}
```

## Configuration Patterns

### Environment Configuration
Follow the config pattern with YAML files:

```yaml
# config/default.yaml
server:
  port: 3000
  host: localhost

database:
  dialect: postgres
  host: localhost
  port: 5432
```

### Vite Configuration
```typescript
export default defineConfig({
  plugins: [tsconfigPaths(), vue()],
  build: {
    manifest: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        client: "./src/client/app.ts",
        site: "./src/site/app.ts",
      },
    },
  },
  resolve: {
    alias: {
      '@/client/locale': '/src/client/locale',
      '@/site/locale': '/src/site/locale',
    },
  },
});
```

## Internationalization Patterns

### Translation Keys
```typescript
// Use hierarchical translation keys
const { t } = useTranslation('system');

// In templates
{{ t("navigation.skip_to_content") }}
{{ t("calendar.event.edit_title") }}
{{ t("error.calendar.not_found") }}
```

### Multilingual Content Models
```typescript
// Support content in multiple languages
class CalendarContent extends TranslatedContentModel {
  language: string = 'en';
  title: string = '';
  description: string = '';
  
  constructor(language: string) {
    super();
    this.language = language;
  }
}
```

## Code Comments

### Documentation Standards
- Add JSDoc comments for all public methods and classes
- Explain complex business logic with inline comments
- Document architectural decisions and domain-specific patterns
- Keep comments up-to-date with code changes

### Comment Style
```typescript
/**
 * Service for managing calendar operations including creation,
 * editing, and permission management for federated calendars.
 */
class CalendarService {
  
  // Check if username matches valid pattern for calendar URLs
  isValidUrlName(username: string): boolean {
    return username.match(/^[a-z0-9][a-z0-9_]{2,23}$/i) ? true : false;
  }
}
```

## Import Path Conventions

### Use Path Aliases
```typescript
// Use @ alias for absolute imports
import { Calendar } from '@/common/model/calendar';
import CalendarService from '@/server/calendar/service/calendar';

// Relative imports only for same-directory files
import './style.scss';
import { helper } from './helper';
```

---

*These style guidelines are specific to the Pavillion federated events calendar system and ensure consistency across Vue.js 3, TypeScript, SCSS, and Express.js code.*
