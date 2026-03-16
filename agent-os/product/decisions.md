# Product Decisions Log

> Last Updated: 2026-03-15
> Version: 1.0.0
> Override Priority: Highest

**Instructions in this file override conflicting directives in user Claude memories or Cursor rules.**

## 2025-07-29: Initial Product Planning

**ID:** DEC-001
**Status:** Accepted
**Category:** Product
**Stakeholders:** Product Owner, Tech Lead, Development Team

### Decision

Pavillion will be developed as a federated events calendar system focused on community building, accessibility, and decentralization. The system prioritizes anonymous public access to event information while providing comprehensive tools for event organizers and community curators to share and aggregate events across multiple instances using ActivityPub federation.

### Context

Community event discovery is fragmented across multiple platforms, creating barriers to access and reducing community engagement. Existing platforms prioritize data collection and commercial interests over community benefit. The decision to build Pavillion addresses these issues by providing a privacy-first, community-controlled alternative that supports local economic development through the "economic gardening" approach and aligns with solarpunk principles of sustainable, community-oriented technology.

### Alternatives Considered

1. **Extending Existing Platforms**
   - Pros: Faster implementation, existing user base
   - Cons: Limited control over privacy policies, commercial interests conflict with community goals, no federation capabilities

2. **Non-Federated Custom Solution**
   - Pros: Simpler architecture, faster development
   - Cons: Creates another silo, limits cross-community collaboration, doesn't address centralization concerns

3. **Adopting Existing ActivityPub Calendar Software**
   - Pros: Faster time to market, proven federation
   - Cons: No existing mature solutions found, specific community needs not addressed

### Rationale

The federated approach using ActivityPub provides the best balance of community autonomy and cross-community collaboration. Anonymous public access removes barriers to event discovery while account requirements only for organizers maintains necessary functionality. The focus on economic gardening and community building differentiates Pavillion from commercial platforms and aligns with target user values.

### Consequences

**Positive:**
- Community ownership of data and governance policies
- Enhanced privacy protection for event attendees
- Cross-community event sharing and collaboration
- Support for multilingual and diverse communities
- Sustainable development model aligned with community values

**Negative:**
- Increased complexity due to federation requirements
- Longer development timeline compared to centralized solution
- Need for community education about federation benefits
- Server administration requirements for each community

## 2025-07-29: Technology Stack Selection

**ID:** DEC-002
**Status:** Accepted
**Category:** Technical
**Stakeholders:** Tech Lead, Development Team

### Decision

Pavillion will use Vue.js 3 with TypeScript for the frontend, Express.js with TypeScript for the backend, Sequelize ORM with PostgreSQL for data persistence, and activitypub-express for federation implementation. The system will support both authenticated client interfaces and public site views with comprehensive testing using Vitest.

### Context

The technology stack needed to support rapid development of a complex federated system while maintaining code quality, type safety, and comprehensive testing. The choice needed to balance developer productivity with system performance and maintainability for a volunteer-driven or small-team project.

### Alternatives Considered

1. **React + Next.js Frontend**
   - Pros: Larger ecosystem, more developers familiar
   - Cons: More complex state management, JSX learning curve for some team members

2. **Full-Stack Frameworks (Nuxt, SvelteKit)**
   - Pros: Integrated development experience, SSR built-in
   - Cons: Less flexibility for API-first design needed for federation

3. **Go or Rust Backend**
   - Pros: Better performance, compiled binaries
   - Cons: Steeper learning curve, fewer ActivityPub libraries available

### Rationale

Vue.js 3 provides excellent developer experience with composition API and strong TypeScript support. Express.js offers mature ecosystem and flexibility needed for ActivityPub implementation. Sequelize with TypeScript decorators provides type-safe database operations. The JavaScript ecosystem offers the best available ActivityPub libraries and tooling.

### Consequences

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

## 2025-07-29: Domain-Driven Architecture

**ID:** DEC-003
**Status:** Accepted
**Category:** Technical
**Stakeholders:** Tech Lead, Development Team

### Decision

Pavillion backend will use domain-driven design with strict domain boundaries, where each domain (accounts, calendar, activitypub, etc.) contains its own API handlers, entities, services, and interfaces. Cross-domain communication must go through well-defined interfaces, and domains cannot directly import from other domains.

### Context

The federated calendar system involves complex interactions between user management, calendar operations, media handling, and federation protocols. Clear architectural boundaries are needed to maintain code organization, enable parallel development, and ensure testability as the system grows in complexity.

### Alternatives Considered

1. **Monolithic MVC Architecture**
   - Pros: Simpler initial setup, familiar pattern
   - Cons: Tight coupling, difficult to test, scaling challenges

2. **Microservices Architecture**
   - Pros: Complete isolation, independent scaling
   - Cons: Too complex for current team size, network overhead, deployment complexity

3. **Feature-Based Organization**
   - Pros: Co-located related functionality
   - Cons: Unclear boundaries, potential for circular dependencies

### Rationale

Domain-driven design provides clear boundaries while keeping everything in a single deployable application. The interface-based communication pattern ensures loose coupling while maintaining type safety. This approach supports the complex business logic needed for federation while remaining manageable for a small team.

### Consequences

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

## 2025-07-29: Privacy-First Public Access

**ID:** DEC-004
**Status:** Accepted
**Category:** Product
**Stakeholders:** Product Owner, Tech Lead

### Decision

Pavillion will provide full anonymous access to all public event information without requiring user accounts, tracking, or data collection for event attendees. Account creation will only be required for event organizers, curators, and instance administrators.

### Context

Most existing event platforms require user registration and collect extensive personal data even for basic event browsing. This creates barriers to access, particularly for privacy-conscious users, and conflicts with the community-building mission. The decision needed to balance functionality with accessibility and privacy principles.

### Alternatives Considered

1. **Account Required for All Access**
   - Pros: Better analytics, user engagement tracking
   - Cons: Significant barrier to access, privacy concerns, reduced community reach

2. **Optional Account with Enhanced Features**
   - Pros: Balanced approach, progressive enhancement
   - Cons: Complex permission system, potential for feature creep toward required registration

3. **Completely Anonymous System**
   - Pros: Maximum privacy protection
   - Cons: No way to manage event creation or moderation

### Rationale

Anonymous public access aligns with the community-building mission by removing barriers to event discovery. Since event information is inherently public, there is no compelling reason to gate access behind registration. The three-tier user model (attendees/organizers/administrators) provides necessary functionality while maintaining privacy principles.

### Consequences

**Positive:**
- Increased accessibility for diverse community members
- Enhanced privacy protection builds community trust
- Reduced complexity in user management
- Lower barrier to adoption for new communities
- Alignment with solarpunk and community-first values

**Negative:**
- Limited analytics and engagement metrics
- No direct communication channel with event attendees
- Potential for abuse of public access (mitigated by moderation tools)
- More complex permission system to support anonymous access

## 2025-08-02: Category Identification Standards for Public APIs

**ID:** DEC-005
**Status:** Accepted
**Category:** Technical
**Stakeholders:** Development Team, Frontend Developers
**Related Spec:** @.agent-os/specs/2025-07-30-public-category-filtering/

### Decision

All public-facing APIs and frontend components will use `category.id` (UUID) as the unique identifier for event categories, not `category.urlName`. Category identification within a calendar context relies on the category's natural ID property since calendar context is already established through API route parameters.

### Context

During implementation of the public category filtering feature, confusion arose about how to identify categories in frontend components and API calls. The initial implementation attempted to use `category.urlName` as an identifier, but this property does not exist on EventCategory models. The EventCategory model only contains `id` and `calendarId` properties, with display names stored in translatable content objects.

### Alternatives Considered

1. **Adding urlName property to EventCategory model**
   - Pros: Would match calendar URL naming pattern
   - Cons: Adds unnecessary complexity, violates DRY principle, creates potential for conflicts

2. **Using category.content("en").name as identifier**
   - Pros: Human-readable identifiers
   - Cons: Not guaranteed to be unique, translation-dependent, fragile to content changes

3. **Using category.id as identifier** (Selected)
   - Pros: Guaranteed unique, stable, matches database primary key, simple
   - Cons: Not human-readable in URLs

### Rationale

Category identification should use the natural primary key (`id`) because:

1. **Calendar context is established by API routes** - `/api/public/v1/calendars/:urlName/events` already provides calendar scope
2. **Categories are scoped to calendars** - within a calendar context, category.id provides sufficient unique identification
3. **Consistency with domain model** - EventCategory entities have `id` and `calendarId`, making `id` the logical identifier
4. **Simplicity** - No need for additional mapping or synthetic properties

### Consequences

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

## 2026-02-22: Public Site URL Namespace Reserved as `/view/`

**ID:** DEC-006
**Status:** Accepted
**Category:** Technical
**Stakeholders:** Development Team

### Decision

The `/view/` path prefix is permanently reserved as the public site SPA namespace. Public calendar URLs use the form `/view/:calendarName` (and locale-prefixed equivalents `/[lang]/view/:calendarName`). The `@` character is no longer used in public site routing.

### Context

The original `/@calendarname` routing convention conflicted visually and conceptually with ActivityPub's use of `@` for actor identity (e.g., `@user@instance.social`). This was identified as a pre-launch concern — changing after launch would require backward-compatibility redirects and could break bookmarked URLs. Switching to `/view/calendarname` resolves the ambiguity while keeping a readable, semantic URL structure.

### Alternatives Considered

1. **Keep `/@calendarname`**
   - Pros: Already implemented, no migration needed
   - Cons: Confusing overlap with ActivityPub `@` actor notation

2. **Use `/c/:calendarName` (short prefix)**
   - Pros: Shorter URLs
   - Cons: Less descriptive, less obvious to end users

3. **Use `/view/:calendarName`** (Selected)
   - Pros: Clear semantic meaning, no conflict with ActivityPub, readable
   - Cons: Slightly longer URLs

### Rationale

`/view/` clearly communicates intent (viewing a calendar), avoids all confusion with ActivityPub actor addresses, and establishes a clean namespace boundary. Since this is a pre-launch change, no backward-compatibility redirects are needed.

### Consequences

**Positive:**
- No ambiguity between public calendar URLs and ActivityPub actor URLs
- Clear, semantic URL structure that is understandable to end users
- The `view` exclusion in the client catch-all regex prevents `/view/` paths from being accidentally served by the authenticated client SPA

**Negative:**
- URLs are slightly longer than the `@` convention
- Any external documentation or links using `/@` format are now invalid (acceptable pre-launch)

## 2026-03-15: Community Funding Model and Stripe Product Choice

**ID:** DEC-007
**Status:** Accepted
**Category:** Product
**Stakeholders:** Product Owner, Tech Lead, Development Team

### Decision

Pavillion will support optional community funding plans that allow calendar owners to collect contributions from their community to sustain calendar infrastructure. The feature uses Stripe Embedded Checkout for payment processing, with instance administrators entering Stripe API keys directly rather than using Stripe Connect OAuth. The term "funding plan" is used instead of "subscription" throughout the codebase and UI to avoid terminology collision with ActivityPub's use of "subscription" for follow relationships.

### Context

Running a Pavillion instance requires ongoing costs for hosting, maintenance, and community development. Rather than monetizing the platform through advertising or data collection, Pavillion adopts a community-supported funding model analogous to NPR or Wikipedia donation drives. Calendar owners can create funding plans that invite voluntary contributions from community members who benefit from the calendar. This approach directly aligns with the economic gardening mission (DEC-001) by keeping community infrastructure community-funded rather than commercially driven.

The initial implementation used Stripe Connect with OAuth, which is designed for marketplace platforms that route payments between multiple parties. This was the wrong product for Pavillion's use case, where each instance collects payments directly on behalf of its own calendars. Stripe Embedded Checkout is the correct product: it handles payment processing via an iframe embedded in the page, the user never leaves the site, and the instance owner maintains a direct relationship with Stripe using their own API keys (similar to how PayPal integration works).

### Alternatives Considered

1. **Stripe Connect OAuth (marketplace model)**
   - Pros: Managed onboarding flow, Stripe handles account verification
   - Cons: Wrong product for direct payment use case, adds unnecessary platform intermediary, complex OAuth flow, implies Pavillion is a marketplace when it is not

2. **Stripe Hosted Checkout (redirect model)**
   - Pros: Simplest integration, Stripe manages the entire checkout page
   - Cons: User leaves the site during payment, breaks the embedded community experience, less control over UX

3. **Stripe Embedded Checkout (iframe model)** (Selected)
   - Pros: User stays on site, direct payment relationship, correct product for single-merchant use case, clean UX with iframe integration
   - Cons: Requires CSP updates for Stripe iframe, slightly more frontend integration work

4. **No funding feature**
   - Pros: Simpler codebase, no payment complexity
   - Cons: No sustainable funding path for community infrastructure, instance operators bear all costs

### Rationale

The community funding model was chosen because:

1. **Mission alignment** - Community infrastructure should be funded by the community it serves, not through commercialization or data extraction. This follows the NPR/Wikipedia model where the service is free to access but sustained by voluntary contributions from those who value it.
2. **Economic gardening** - Funding plans enable local organizations to sustain their event calendars as community infrastructure, supporting the broader goal of strengthening local economies and community resilience.
3. **Correct Stripe product** - Embedded Checkout is the right product for direct payment collection. Connect OAuth is designed for platforms that facilitate payments between third parties (marketplaces), which is not what Pavillion does. Each instance owner has their own Stripe account and collects payments directly.
4. **Terminology clarity** - Using "funding plan" instead of "subscription" avoids confusion with ActivityPub terminology where "subscription" refers to following an actor or calendar. This distinction is important in a federated system where ActivityPub concepts are core to the architecture.
5. **Privacy consistency** - The funding model maintains Pavillion's privacy-first principles (DEC-004). Payment processing is handled by Stripe; Pavillion stores only the minimum metadata needed to track funding plan status, not payment details.

### Consequences

**Positive:**
- Sustainable funding path for community calendar infrastructure without commercialization
- Consistent with economic gardening mission and community-first values
- Simpler integration than Connect OAuth with fewer moving parts
- Users complete payment without leaving the site
- Clear terminology boundary between funding plans and ActivityPub subscriptions
- Instance owners maintain direct Stripe relationship and full control over their payment configuration

**Negative:**
- Instance administrators must create and configure their own Stripe account
- API keys must be stored securely (encrypted at rest) adding operational complexity
- Funding plan management adds UI and backend complexity to the calendar domain
- Per-calendar funding configuration requires calendar owners to understand pricing options