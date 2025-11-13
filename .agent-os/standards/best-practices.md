# Development Best Practices

> Version: 1.0.0
> Last updated: 2025-07-29
> Scope: Global development standards

## Context

This file is part of the Agent OS standards system. These global best practices are referenced by all product codebases and provide default development guidelines. Individual projects may extend or override these practices in their `.agent-os/product/dev-best-practices.md` file.

## Core Principles

### Keep It Simple
- Implement code in the fewest lines possible
- Avoid over-engineering solutions
- Choose straightforward approaches over clever ones

### Optimize for Readability
- Prioritize code clarity over micro-optimizations
- Write self-documenting code with clear variable names
- Add comments for "why" not "what"

### DRY (Don't Repeat Yourself)
- Extract repeated business logic to private methods
- Extract repeated UI markup to reusable components
- Create utility functions for common operations

## Dependencies

### Choose Libraries Wisely
When adding third-party dependencies:
- Select the most popular and actively maintained option
- Check the library's GitHub repository for:
  - Recent commits (within last 6 months)
  - Active issue resolution
  - Number of stars/downloads
  - Clear documentation

## Code Organization

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

## Development Workflow

### Task Management
- **Work with task lists** - Create and maintain detailed markdown task lists
- **Incremental implementation** - Complete each subtask fully before proceeding
- **Working state** - Each completed subtask should leave project functional

### Design Philosophy
- **Simplicity over complexity** - Favor binary states over multi-state systems
- **Direct relationships** - Avoid unnecessary abstraction layers
- **Consistent patterns** - Follow existing codebase patterns

### Pre-commit Checklist
1. **Run linter**: `npm run lint` (fix errors before proceeding)
2. **Run tests**: `npx vitest` (ensure all tests pass)
3. **Check coverage**: `npm run test:coverage` (maintain 80%+ coverage)
4. **Verify builds**: `npm run build` (catch TypeScript/Vue compilation errors)

### Commit messages
1. **Always** confirm with the user before committing code
2. Follow the conventional commit format
3. **Do not** reference task numbers if you are working from a task list
4. **Do** reference github issue numbers or other bug tracker identifiers if present

## Important Reminders

1. **Never** modify core architectural patterns without discussion
2. **Always** follow entity/model separation - no business logic in entities
3. **Always** push business logic to service layer, not API handlers
4. **Always** use domain interfaces for cross-domain communication
5. **Always** run linting and tests before committing
6. **Always** maintain task lists for multi-step implementations
10. **Maintain** working state after each incremental change
