# Error Serialization Pattern

Domain exceptions are serialized across HTTP boundaries via `errorName`, allowing the frontend to reconstruct typed errors.

## Exception Structure

```typescript
// src/common/exceptions/{domain}.ts
export class InvalidUrlNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUrlNameError'; // Critical for serialization
    Object.setPrototypeOf(this, InvalidUrlNameError.prototype);
  }
}
```

## API Response Format

```typescript
// Always include errorName for typed errors
res.status(400).json({
  error: error.message,    // Human-readable message
  errorName: error.name    // Exception class name for reconstruction
});
```

## Status Code Convention

| Exception Pattern | Status Code |
|-------------------|-------------|
| `*NotFoundError` | 404 |
| `*ValidationError`, `Invalid*Error` | 400 |
| `Insufficient*Error`, `Unauthorized*` | 403 |
| `*AlreadyExistsError` | 409 |
| Unknown/unexpected | 500 |

## Frontend Reconstruction

```typescript
// src/client/service/*.ts
const errorMap: Record<string, new () => Error> = {
  'InvalidUrlNameError': InvalidUrlNameError,
  'CalendarNotFoundError': CalendarNotFoundError,
};

if (errorName && errorName in errorMap) {
  throw new errorMap[errorName]();
}
```

## Validation Error Pattern

### ValidationError Base Class

The `ValidationError` base class provides a standardized way to handle validation failures with support for multiple error messages and optional field-level error mapping.

```typescript
// src/common/exceptions/base.ts
export class ValidationError extends Error {
  public errors: string[];
  public fields?: Record<string, string[]>;

  constructor(errors: string | string[], fields?: Record<string, string[]>) {
    const errorArray = typeof errors === 'string' ? [errors] : errors;
    super(errorArray.join('; '));
    this.name = 'ValidationError';
    this.errors = errorArray;
    this.fields = fields;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
```

### Creating Custom ValidationError Subclasses

Domain-specific validation errors should extend `ValidationError` to maintain type consistency:

```typescript
// src/common/exceptions/report.ts
export class ReportValidationError extends ValidationError {
  constructor(errors: string[] | string = 'Invalid report data') {
    const errorArray = typeof errors === 'string' ? [errors] : errors;
    super(errorArray.length > 0 ? errorArray : ['Invalid report data']);
    this.name = 'ReportValidationError';
    Object.setPrototypeOf(this, ReportValidationError.prototype);
  }
}

// src/common/exceptions/calendar.ts
export class LocationValidationError extends ValidationError {
  constructor(errors: string[]) {
    super(errors);
    this.name = 'LocationValidationError';
    Object.setPrototypeOf(this, LocationValidationError.prototype);
  }
}
```

### Using sendValidationError in API Handlers

The `ExpressHelper.sendValidationError()` method provides a standardized way to send validation error responses:

```typescript
// src/server/{domain}/api/v1/{routes}.ts
import ExpressHelper from '@/server/common/helper/express';
import { ValidationError } from '@/common/exceptions/base';
import { ReportValidationError } from '@/common/exceptions/report';

async createReport(req: Request, res: Response) {
  try {
    const account = req.user as Account;
    const report = await this.service.createReport(account, req.body);
    res.status(201).json(report.toObject());
  }
  catch (error) {
    if (error instanceof ValidationError) {
      return ExpressHelper.sendValidationError(res, error);
    }
    // Handle other error types...
  }
}
```

### Service-Layer Validation Pattern

Validation logic should be performed in the service layer, not in API handlers. Services should accumulate all validation errors and throw a single `ValidationError` with all issues:

```typescript
// src/server/moderation/service/moderation.ts
private validateReportFields(
  eventId: string,
  category: ReportCategory,
  description: string
): string[] {
  const errors: string[] = [];

  // UUID validation
  if (!eventId || typeof eventId !== 'string' || !UUID_REGEX.test(eventId)) {
    errors.push('Event ID must be a valid UUID');
  }

  // Enum validation
  if (!category || !['spam', 'inappropriate', 'inaccurate', 'other'].includes(category)) {
    errors.push('Category is required and must be one of: spam, inappropriate, inaccurate, other');
  }

  // Length validation
  if (!description || description.trim().length < 10) {
    errors.push('Description must be at least 10 characters');
  }

  return errors;
}

async createReport(reportData: ReportData): Promise<Report> {
  // Accumulate all validation errors
  const errors: string[] = [
    ...this.validateReportFields(reportData.eventId, reportData.category, reportData.description),
  ];

  // Throw once with all errors
  if (errors.length > 0) {
    throw new ReportValidationError(errors);
  }

  // Proceed with business logic...
}
```

### Validation Error Response Format

The `sendValidationError` helper produces responses in this format:

```typescript
// Single validation error
{
  "error": "Event ID must be a valid UUID",
  "errorName": "ValidationError"
}

// Multiple validation errors (joined with '; ')
{
  "error": "Event ID must be a valid UUID; Category is required",
  "errorName": "ReportValidationError"
}

// With optional field-level mapping
{
  "error": "Validation failed",
  "errorName": "ValidationError",
  "fields": {
    "eventId": ["Event ID must be a valid UUID"],
    "category": ["Category is required"]
  }
}
```

### When to Use ValidationError vs Other Error Types

| Error Type | Use Case | Example |
|------------|----------|---------|
| `ValidationError` | Invalid input format, type, or business rule violation | Invalid UUID, missing required field, value out of range |
| `*NotFoundError` | Resource doesn't exist | Calendar not found, Event not found |
| `*AlreadyExistsError` | Duplicate resource creation | URL name already exists |
| `Insufficient*Error` | Authorization failure | User lacks permission to modify calendar |
| `RateLimitError` | Rate limiting exceeded | Too many reports submitted |

### Complete API Handler Example

```typescript
import { Request, Response } from 'express';
import ExpressHelper from '@/server/common/helper/express';
import { ValidationError } from '@/common/exceptions/base';
import { LocationValidationError } from '@/common/exceptions/calendar';
import { EventNotFoundError, CalendarNotFoundError } from '@/common/exceptions/calendar';

class EventRoutes {
  async updateEvent(req: Request, res: Response) {
    try {
      const account = req.user as Account;
      const { eventId } = req.params;
      const eventData = req.body;

      // Service layer handles all validation
      const updatedEvent = await this.service.updateEvent(
        account,
        eventId,
        eventData
      );

      res.json(updatedEvent.toObject());
    }
    catch (error) {
      // Handle validation errors (400)
      if (error instanceof ValidationError) {
        return ExpressHelper.sendValidationError(res, error);
      }

      // Handle not found errors (404)
      if (error instanceof EventNotFoundError || error instanceof CalendarNotFoundError) {
        return res.status(404).json({
          error: error.message,
          errorName: error.name,
        });
      }

      // Handle unexpected errors (500)
      console.error('Unexpected error:', error);
      res.status(500).json({
        error: 'An unexpected error occurred',
        errorName: 'UnknownError',
      });
    }
  }
}
```

## Related Standards

- **Service-Layer Validation**: "API handlers handle HTTP concerns only, services contain all business logic" — see the `backend-domain-structure` skill
- **Domain-Driven Design**: Services should validate all inputs and throw domain-specific exceptions
- **Error Response Format**: All error responses must include both `error` (message) and `errorName` (class name) fields
