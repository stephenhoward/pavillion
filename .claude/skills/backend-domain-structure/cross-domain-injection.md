# Cross-Domain Dependency Injection

Domains receive dependencies on other domains via constructor injection. This prevents circular imports and makes dependencies explicit.

## Constructor Injection

```typescript
// Domain interface receives dependencies in constructor
class CalendarInterface {
  constructor(
    private eventBus: EventEmitter,
    private accountsInterface?: AccountsInterface
  ) {
    this.calendarService = new CalendarService(eventBus, accountsInterface);
  }
}
```

## Post-Init Setters (for circular dependencies)

When two domains need each other, use a setter after initialization:

```typescript
// AccountsInterface needs CalendarInterface, but Calendar needs Accounts
class AccountsInterface {
  setCalendarInterface(calendarInterface: CalendarInterface): void {
    this.accountService.setCalendarInterface(calendarInterface);
  }
}

// In app initialization
const accountsInterface = new AccountsInterface(eventBus);
const calendarInterface = new CalendarInterface(eventBus, accountsInterface);
accountsInterface.setCalendarInterface(calendarInterface); // Break the cycle
```

## Initialization Order

Domains must be initialized in dependency order:

1. **Configuration** — No dependencies
2. **Accounts** — No domain dependencies
3. **Media** — May depend on Accounts
4. **Calendar** — Depends on Accounts, Media
5. **ActivityPub** — Depends on Calendar, Accounts
6. **Public** — Depends on Calendar

*Note: Exact order is determined by `src/server/app.ts`*

## Rules

- Never import services directly from another domain
- Pass interfaces through constructors, not global singletons
- Use setters only to break circular dependencies
- EventBus is the only shared global (passed to all domains)
