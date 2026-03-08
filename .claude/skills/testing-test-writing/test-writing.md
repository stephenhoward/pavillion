## Test Philosophy

- **Write Minimal Tests During Development**: Focus on completing the feature first, then add strategic tests at logical completion points
- **Test Only Core User Flows**: Write tests for critical paths and primary workflows. Skip non-critical utilities until instructed
- **Defer Edge Case Testing**: Do NOT test edge cases or validation unless business-critical
- **Test Behavior, Not Implementation**: Focus on what the code does, not how
- **Clear Test Names**: Descriptive names explaining what's tested and expected outcome
- **Fast Execution**: Keep unit tests fast (milliseconds)

## Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';

describe('CalendarService.createCalendar', () => {
  let service: CalendarService;
  let sandbox = sinon.createSandbox(); // One sandbox per describe block

  beforeEach(() => {
    service = new CalendarService(new EventEmitter()); // Fresh instance per test
  });

  afterEach(() => {
    sandbox.restore(); // Always restore ALL stubs
  });

  it('should create a calendar with valid data', async () => {
    const stub = sandbox.stub(CalendarEntity, 'create');
    stub.resolves(CalendarEntity.build({ id: '123', url_name: 'test' }));

    const result = await service.createCalendar(account, data);

    expect(stub.calledOnce).toBe(true);
    expect(result.urlName).toBe('test');
  });
});
```

## Sinon Patterns

- **Sandbox per describe block**: Create once, restore in afterEach
- **Stub entity static methods**: `sandbox.stub(EntityClass, 'findAll')`
- **Use `.build()` for entities**: `EntityClass.build({...})` not `new EntityClass()`
- **Verify calls**: `stub.calledOnce`, `stub.firstCall.args[0]`

## Test Data Strategy

- **Unit tests**: Always ephemeral — create in beforeEach, destroy in afterEach
- **Integration tests**: Ephemeral unless prohibitively slow
- **E2E tests**: Use test database with seed data
- **Never share state** between tests
