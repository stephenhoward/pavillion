# DEC-002: Technology Stack Selection

> Date: 2025-07-29
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead, Development Team

## Decision

Pavillion will use Vue.js 3 with TypeScript for the frontend, Express.js with TypeScript for the backend, Sequelize ORM with PostgreSQL for data persistence, and activitypub-express for federation implementation. The system will support both authenticated client interfaces and public site views with comprehensive testing using Vitest.

## Context

The technology stack needed to support rapid development of a complex federated system while maintaining code quality, type safety, and comprehensive testing. The choice needed to balance developer productivity with system performance and maintainability for a volunteer-driven or small-team project.

## Alternatives Considered

1. **React + Next.js Frontend**
   - Pros: Larger ecosystem, more developers familiar
   - Cons: More complex state management, JSX learning curve for some team members

2. **Full-Stack Frameworks (Nuxt, SvelteKit)**
   - Pros: Integrated development experience, SSR built-in
   - Cons: Less flexibility for API-first design needed for federation

3. **Go or Rust Backend**
   - Pros: Better performance, compiled binaries
   - Cons: Steeper learning curve, fewer ActivityPub libraries available

## Rationale

Vue.js 3 provides excellent developer experience with composition API and strong TypeScript support. Express.js offers mature ecosystem and flexibility needed for ActivityPub implementation. Sequelize with TypeScript decorators provides type-safe database operations. The JavaScript ecosystem offers the best available ActivityPub libraries and tooling.

## Consequences

**Positive:**
- Rapid development with strong typing
- Excellent testing infrastructure
- Rich ecosystem for federation features
- Accessible to volunteer developers
- Strong i18n support for multilingual features

**Negative:**
- Runtime language performance compared to compiled alternatives
- More complex build process with multiple compilation targets
- Dependency management complexity in JavaScript ecosystem
