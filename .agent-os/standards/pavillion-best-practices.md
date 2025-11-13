# Pavillion Development Best Practices

> Version: 1.0.0
> Last updated: 2025-07-29
> Scope: Pavillion federated events calendar system

## Context

This file provides development best practices specifically for the Pavillion project - a federated events calendar system built with Vue.js 3, TypeScript, Express.js, and ActivityPub federation. These practices extend the global .agent-os standards with Pavillion-specific patterns and requirements.

## Project Architecture Principles

### Domain-Driven Design
- **Maintain strict domain boundaries** - Never cross-import between server domains
- **Use interface-based communication** - Domains communicate through well-defined interfaces (`domain.interface`)
- **Event-driven updates** - Use shared `eventBus` for asynchronous cross-domain communication
- **Single responsibility** - Each domain handles only its specific business concerns

### Entity/Model Separation Pattern
**Critical**: Maintain strict separation between database entities and domain models:

- **Entities** (`src/server/*/entity/`): Pure database storage with Sequelize
  - `toModel()` method to convert to domain model
  - `fromModel()` static method to create from domain model
  - No business logic - only data persistence
  
- **Models** (`src/common/model/`): Domain logic and shared data structures
  - Extend base `Model` class with business methods
  - `toObject()` and `fromObject()` for serialization
  - Usable in both frontend and backend
  - No database dependencies

### API Handler vs Service Layer Separation
**Critical**: API handlers handle HTTP concerns only, services contain all business logic:

- **API Handlers** (`src/server/*/api/`): Request/response handling
  - Parse request parameters and validate input format
  - Call service methods with primitive values (IDs, strings, numbers)
  - Transform service responses for HTTP
  - **Never** perform existence checks or contain business logic

- **Service Layer** (`src/server/*/service/`): All business logic and validation
  - Accept primitive parameters, perform internal existence checks
  - Contain all domain rules and cross-domain communication
  - Return domain models or throw domain-specific exceptions
  - Handle authentication/authorization logic

## Code Quality Standards

### TypeScript Excellence
- **Always use TypeScript** - Never use `any` type without explicit reasoning
- **Leverage decorators** - Use Sequelize-typescript decorators for entities
- **Explicit typing** - Define interfaces for all data structures
- **Strict configuration** - Follow project's strict TypeScript settings

### Testing Requirements
- **Comprehensive coverage** - Maintain 80%+ test coverage
- **Entity/Model testing** - Separate test files for entities vs models
- **Service testing pattern** - Use real `build()` calls, stub `save()` on prototype
- **Integration tests** - Test critical end-to-end workflows
- **Round-trip testing** - Verify entity ↔ model conversions work correctly

### Federation Considerations
- **ActivityPub compliance** - Follow specifications precisely for federation features
- **Security first** - Consider security implications of all federated features
- **Graceful failures** - Handle network failures and remote instance issues
- **Rate limiting** - Respect remote instance rate limits

## Development Workflow

### Task Management
- **Work with task lists** - Create and maintain detailed markdown task lists
- **Incremental implementation** - Complete each subtask fully before proceeding
- **Track file changes** - Update "Relevant Files" sections in task lists
- **Working state** - Each completed subtask should leave project functional

### Design Philosophy
- **Simplicity over complexity** - Favor binary states over multi-state systems
- **Direct relationships** - Avoid unnecessary abstraction layers
- **Clear ownership** - Every permission/relationship has clear audit trails
- **Consistent patterns** - Follow existing codebase patterns

### Pre-commit Checklist
1. **Run linter**: `npm run lint` (fix errors before proceeding)
2. **Run tests**: `npx vitest` (ensure all tests pass)
3. **Check coverage**: `npm run test:coverage` (maintain 80%+ coverage)
4. **Verify builds**: `npm run build` (catch TypeScript/Vue compilation errors)

## Dual Application Architecture

### Client vs Site Applications
Pavillion has two distinct Vue.js applications:

- **Client App** (`src/client/`): Authenticated user interface
  - Calendar management, event creation/editing
  - User dashboard, admin panel
  - Requires authentication for access

- **Site App** (`src/site/`): Public calendar viewer
  - Public calendar viewing at `/@{calendarName}`
  - Event browsing for unauthenticated users
  - No authentication required

**Never** mix components between client and site applications - maintain clear separation.

## Cross-Domain Communication Patterns

### Synchronous Communication
```typescript
// Use domain interfaces for direct calls
const event = await calendarDomain.interface.getEvent(eventId);
```

### Asynchronous Communication
```typescript
// Use eventBus for event-driven updates
eventBus.emit('eventCreated', { eventId, calendarId });
eventBus.on('eventUpdated', handleEventUpdate);
```

### Service Dependencies
```typescript
// Inject domain interfaces as dependencies
class CalendarService {
  constructor(
    private accountsInterface?: AccountsInterface,
    private configurationInterface?: ConfigurationInterface,
  ) {}
}
```

## Security and Permissions

### Authentication Patterns
- Use JWT tokens for API authentication
- Implement role-based access control (RBAC)
- Support multiple registration modes (open, invitation, apply, closed)

### Permission Checking
- **Service layer responsibility** - All permission checks in services
- **Clear ownership** - Every resource has identifiable owners/editors
- **Audit trails** - Track who granted permissions and when

## Development Server Behavior

### Auto-restart Patterns
- **Backend changes** trigger automatic server restart
- **Database resets** on restart with fresh seed data
- **Frontend changes** (Vue components) don't trigger restart
- **Test consistently** - Use seeded accounts (admin@pavillion.dev, test@example.com)

### Port Configuration
- **Application server**: Port 3000 (configured in `config/default.yaml`)
- **Vite dev server**: Port 5173 (assets only in development)
- **Always use**: `http://localhost:3000` for application access

## Error Handling Patterns

### Domain-Specific Exceptions
```typescript
// Use specific exceptions for clear error handling
throw new CalendarNotFoundError();
throw new CalendarEditorPermissionError();
throw new UrlNameAlreadyExistsError();
```

### Service Error Handling
```typescript
// Services throw exceptions, API handlers catch and transform
try {
  await calendarService.grantEditAccess(calendarId, editorAccountId);
  res.status(201).json({ success: true });
} catch (error) {
  handleError(res, error);
}
```

## Internationalization (i18n)

### Translation Structure
- Use i18next for multilingual support
- Separate locale files for client (`src/client/locales/`) and site (`src/site/locales/`)
- Support calendar content in multiple languages
- Default language: English (`en`)

### Content Models
```typescript
// Use TranslatedModel pattern for multilingual content
class Calendar extends TranslatedModel<CalendarContent> {
  protected createContent(language: string): CalendarContent {
    return new CalendarContent(language);
  }
}
```

## Important Reminders

1. **Never** modify core architectural patterns without discussion
2. **Always** follow entity/model separation - no business logic in entities
3. **Always** push business logic to service layer, not API handlers
4. **Always** use domain interfaces for cross-domain communication
5. **Always** run linting and tests before committing
6. **Always** maintain task lists for multi-step implementations
7. **Respect** dual application architecture - don't mix client/site code
8. **Consider** federation implications for all calendar/event features
9. **Test** both authenticated (client) and public (site) user journeys
10. **Maintain** working state after each incremental change

---

*These practices are specific to the Pavillion federated events calendar system and should be followed by all developers and AI agents working on the project.*
