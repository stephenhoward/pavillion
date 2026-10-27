# DEC-003: Domain-Driven Architecture

> Date: 2025-07-29
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead, Development Team

## Decision

Pavillion backend will use domain-driven design with strict domain boundaries, where each domain (accounts, calendar, activitypub, etc.) contains its own API handlers, entities, services, and interfaces. Cross-domain communication must go through well-defined interfaces, and domains cannot directly import from other domains.

## Context

The federated calendar system involves complex interactions between user management, calendar operations, media handling, and federation protocols. Clear architectural boundaries are needed to maintain code organization, enable parallel development, and ensure testability as the system grows in complexity.

## Alternatives Considered

1. **Monolithic MVC Architecture**
   - Pros: Simpler initial setup, familiar pattern
   - Cons: Tight coupling, difficult to test, scaling challenges

2. **Microservices Architecture**
   - Pros: Complete isolation, independent scaling
   - Cons: Too complex for current team size, network overhead, deployment complexity

3. **Feature-Based Organization**
   - Pros: Co-located related functionality
   - Cons: Unclear boundaries, potential for circular dependencies

## Rationale

Domain-driven design provides clear boundaries while keeping everything in a single deployable application. The interface-based communication pattern ensures loose coupling while maintaining type safety. This approach supports the complex business logic needed for federation while remaining manageable for a small team.

## Consequences

**Positive:**
- Clear separation of concerns
- Easier testing with defined interfaces
- Parallel development possible across domains
- Federation complexity contained within ActivityPub domain
- Easier to reason about data flow and dependencies

**Negative:**
- More initial architectural overhead
- Requires discipline to maintain boundaries
- Some code duplication across domains
- Learning curve for team members unfamiliar with DDD
