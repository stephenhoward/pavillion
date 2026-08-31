## Coding style best practices

- **Consistent Naming Conventions**: Establish and follow naming conventions for variables, functions, classes, and files across the codebase
- **Automated Formatting**: Maintain consistent code style (indenting, line breaks, etc.)
- **Meaningful Names**: Choose descriptive names that reveal intent; avoid abbreviations and single-letter variables except in narrow contexts
- **Small, Focused Functions**: Keep functions small and focused on a single task for better readability and testability
- **Consistent Indentation**: Use consistent indentation (spaces or tabs) and configure your editor/linter to enforce it
- **Remove Dead Code**: Delete unused code, commented-out blocks, and imports rather than leaving them as clutter
- **Backward compatability only when required:** Unless specifically instructed otherwise, assume you do not need to write additional code logic to handle backward compatability.
- **DRY Principle**: Avoid duplication by extracting common logic into reusable functions or modules

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
