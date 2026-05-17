# DEC-001: Initial Product Planning

> Date: 2025-07-29
> Status: Accepted
> Category: Product
> Stakeholders: Product Owner, Tech Lead, Development Team

## Decision

Pavillion will be developed as a federated events calendar system focused on community building, accessibility, and decentralization. The system prioritizes anonymous public access to event information while providing comprehensive tools for event organizers and community curators to share and aggregate events across multiple instances using ActivityPub federation.

## Context

Community event discovery is fragmented across multiple platforms, creating barriers to access and reducing community engagement. Existing platforms prioritize data collection and commercial interests over community benefit. The decision to build Pavillion addresses these issues by providing a privacy-first, community-controlled alternative that supports local economic development through the "economic gardening" approach and aligns with solarpunk principles of sustainable, community-oriented technology.

## Alternatives Considered

1. **Extending Existing Platforms**
   - Pros: Faster implementation, existing user base
   - Cons: Limited control over privacy policies, commercial interests conflict with community goals, no federation capabilities

2. **Non-Federated Custom Solution**
   - Pros: Simpler architecture, faster development
   - Cons: Creates another silo, limits cross-community collaboration, doesn't address centralization concerns

3. **Adopting Existing ActivityPub Calendar Software**
   - Pros: Faster time to market, proven federation
   - Cons: No existing mature solutions found, specific community needs not addressed

## Rationale

The federated approach using ActivityPub provides the best balance of community autonomy and cross-community collaboration. Anonymous public access removes barriers to event discovery while account requirements only for organizers maintains necessary functionality. The focus on economic gardening and community building differentiates Pavillion from commercial platforms and aligns with target user values.

## Consequences

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
