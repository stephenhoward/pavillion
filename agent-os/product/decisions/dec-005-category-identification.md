# DEC-005: Category Identification Standards for Public APIs

> Date: 2025-08-02
> Status: Accepted
> Category: Technical
> Stakeholders: Development Team, Frontend Developers
> Related Spec: @.agent-os/specs/2025-07-30-public-category-filtering/

## Decision

All public-facing APIs and frontend components will use `category.id` (UUID) as the unique identifier for event categories, not `category.urlName`. Category identification within a calendar context relies on the category's natural ID property since calendar context is already established through API route parameters.

## Context

During implementation of the public category filtering feature, confusion arose about how to identify categories in frontend components and API calls. The initial implementation attempted to use `category.urlName` as an identifier, but this property does not exist on EventCategory models. The EventCategory model only contains `id` and `calendarId` properties, with display names stored in translatable content objects.

## Alternatives Considered

1. **Adding urlName property to EventCategory model**
   - Pros: Would match calendar URL naming pattern
   - Cons: Adds unnecessary complexity, violates DRY principle, creates potential for conflicts

2. **Using category.content("en").name as identifier**
   - Pros: Human-readable identifiers
   - Cons: Not guaranteed to be unique, translation-dependent, fragile to content changes

3. **Using category.id as identifier** (Selected)
   - Pros: Guaranteed unique, stable, matches database primary key, simple
   - Cons: Not human-readable in URLs

## Rationale

Category identification should use the natural primary key (`id`) because:

1. **Calendar context is established by API routes** - `/api/public/v1/calendars/:urlName/events` already provides calendar scope
2. **Categories are scoped to calendars** - within a calendar context, category.id provides sufficient unique identification
3. **Consistency with domain model** - EventCategory entities have `id` and `calendarId`, making `id` the logical identifier
4. **Simplicity** - No need for additional mapping or synthetic properties

## Consequences

**Positive:**
- Clear, consistent identification pattern across all public-facing code
- Eliminates confusion about non-existent properties
- Reduces implementation complexity
- Matches existing database and entity patterns
- URL parameters use stable identifiers that won't break with content changes

**Negative:**
- Category IDs in URLs are not human-readable
- Requires developers to understand the scoping model
- API URLs contain UUIDs rather than friendly names
