# DEC-004: Privacy-First Public Access

> Date: 2025-07-29
> Status: Accepted
> Category: Product
> Stakeholders: Product Owner, Tech Lead

## Decision

Pavillion will provide full anonymous access to all public event information without requiring user accounts, tracking, or data collection for event attendees. Account creation will only be required for event organizers, curators, and instance administrators.

## Context

Most existing event platforms require user registration and collect extensive personal data even for basic event browsing. This creates barriers to access, particularly for privacy-conscious users, and conflicts with the community-building mission. The decision needed to balance functionality with accessibility and privacy principles.

## Alternatives Considered

1. **Account Required for All Access**
   - Pros: Better analytics, user engagement tracking
   - Cons: Significant barrier to access, privacy concerns, reduced community reach

2. **Optional Account with Enhanced Features**
   - Pros: Balanced approach, progressive enhancement
   - Cons: Complex permission system, potential for feature creep toward required registration

3. **Completely Anonymous System**
   - Pros: Maximum privacy protection
   - Cons: No way to manage event creation or moderation

## Rationale

Anonymous public access aligns with the community-building mission by removing barriers to event discovery. Since event information is inherently public, there is no compelling reason to gate access behind registration. The three-tier user model (attendees/organizers/administrators) provides necessary functionality while maintaining privacy principles.

## Consequences

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
