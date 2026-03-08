# Architecture Principles

> Version: 1.0.0
> Last Updated: 2026-03-07

This file covers all architectural clarity dimensions for the Pavillion project, anchored by the **conceptual integrity test**:

> **Does this feature read as a natural part of the same product, or does it feel bolted on?**

If someone reading the codebase or using the product would be surprised that this feature exists here — or confused about why it works the way it does — it fails the test.

## Product Documents

These principles reference product-level documents, not code-level conventions:

- `agent-os/product/mission.md` — Product vision, users, differentiators
- `agent-os/product/decisions.md` — Documented architectural decisions (DEC-001 through DEC-006+)
- `agent-os/product/roadmap.md` — Phased development plan and priorities

---

## Conceptual Integrity

Does this feature fit the product's mental model? Would a user or developer be surprised that this exists in this product?

### What to Check

- Does the feature extend existing concepts (calendars, events, federation, categories) or introduce entirely new ones?
- If it introduces a new concept, does that concept fit naturally alongside existing ones?
- Would a user familiar with Pavillion's purpose (federated community events) expect this capability?
- Does the feature use the product's existing vocabulary, or does it introduce new terminology that overlaps with or contradicts existing terms?

### Red Flags

**In specs:**
- Features that require explaining "why this belongs in a calendar product"
- New domain concepts that don't relate to events, calendars, organizations, or federation
- Terminology that conflicts with existing terms (e.g., "subscription" meaning something different from federation follows)
- Features aimed at a user persona not described in `mission.md`

**In code:**
- New domains that don't clearly connect to the product's core concepts
- Models or entities that feel like they belong in a different product
- Service methods that require understanding a concept unrelated to the product's mission
- UI flows that break the user's mental model of "I'm managing community events"

### Evaluation

Ask: "If I described this feature to someone who understands Pavillion's mission, would they nod or tilt their head?"

---

## Decision Adherence

Are documented architectural decisions being respected? If overridden, is it acknowledged?

### What to Check

- Read `agent-os/product/decisions.md` for all accepted decisions
- For each relevant decision, verify the spec or code follows its stated direction
- Key decisions to watch:
  - **DEC-001**: Federated, privacy-first, community-controlled — not centralized or commercial
  - **DEC-002**: Vue.js 3 + Express.js + Sequelize + activitypub-express stack
  - **DEC-003**: Domain-driven design with strict boundaries and interface-based communication
  - **DEC-004**: Anonymous public access — no accounts required for viewing
  - **DEC-005**: Category identification by UUID, not urlName
  - **DEC-006**: `/view/` namespace for public site URLs

### Red Flags

**In specs:**
- Designs that require user registration for public content access (violates DEC-004)
- Cross-domain direct imports instead of interface-based communication (violates DEC-003)
- Centralized features that undermine local instance autonomy (violates DEC-001)
- Technology choices outside the established stack without justification (violates DEC-002)

**In code:**
- Direct service imports across domain boundaries
- Public API endpoints that require authentication for read-only content
- Hardcoded references to specific instances instead of federated patterns
- Database queries that bypass the entity/model separation

### When Decisions Should Be Overridden

Not all decisions are permanent. If a spec or implementation needs to override a decision:
1. The override must be **explicitly acknowledged** in the spec
2. The rationale must explain **why the original decision no longer applies**
3. The override should propose an **update to decisions.md**

An unacknowledged override is always HIGH severity.

---

## Narrative Coherence

Does the spec or code tell a clear story from problem to solution? Can someone trace the "why" through the layers?

### What to Check

- Can you follow the thread from user need → spec requirement → technical design → implementation?
- Is the rationale for design choices documented or at least inferable?
- Does the implementation match the spec's stated intent, not just its literal requirements?
- Are there design choices in the code that make sense only if you know unwritten context?

### Red Flags

**In specs:**
- Requirements without clear user stories or problem statements
- Technical designs that solve a different problem than the one described
- Missing rationale for major design choices ("we will use X" without explaining why X)
- Specs that describe "what" thoroughly but skip "why"

**In code:**
- Implementation approaches that diverge from the spec's described design without explanation
- Complex logic with no comment explaining the business reason
- Service methods whose purpose is unclear from their name and signature
- Test files that test behavior not described in any spec

### Evaluation

Ask: "Could a new developer read this spec and then this code and understand not just what it does, but why it does it this way?"

---

## Responsibility Clarity

Is it clear which domain owns this capability and why? Are there overlapping responsibilities or orphaned concepts?

### What to Check

- Does the feature clearly belong to one domain?
- If it spans domains, are the boundaries between domain responsibilities clear?
- Does the feature create any "shared ownership" ambiguity?
- Is cross-domain communication going through the established interface pattern?

### Red Flags

**In specs:**
- Features described without identifying which domain owns them
- Business logic that could reasonably live in two or more domains with no clear resolution
- New "shared" or "common" services that blur domain boundaries
- Specs that require multiple domains to know about the same business rule

**In code:**
- Business logic duplicated across domains
- "Utility" services that contain domain-specific logic
- Common model classes that contain domain-specific methods
- Event handlers in one domain that reach back into another domain's internals

### Evaluation

Ask: "If I needed to change this behavior, would I know exactly which domain to modify, or would I have to check multiple places?"

---

## Federation Model Alignment

Does this respect the federated architecture model? Does it maintain the local-autonomy-with-sharing principle?

### What to Check

- Does the feature work correctly for a single, non-federated instance?
- Does it degrade gracefully when federation peers are unavailable?
- Does it respect the principle that each instance controls its own data and policies?
- Does it avoid requiring coordination between instances for local functionality?

### Red Flags

**In specs:**
- Features that require multiple instances to function (federation should enhance, not gate)
- Designs that assume a "central" instance or coordinator
- Features that share data between instances without clear user consent or admin control
- Trust assumptions that skip the trust-level framework

**In code:**
- API endpoints that block on federation responses for local user requests
- Data models that assume remote data is always available
- Missing error handling for federation failures
- Automatic data sharing without policy checks

### Evaluation

Ask: "Would this feature work and make sense for a single community instance that never federates? Would federation add value without creating dependency?"

---

## Product Direction

Does this move toward the roadmap's stated goals, or does it pull in a tangential direction?

### What to Check

- Is the feature part of the current or next roadmap phase?
- If it's not on the roadmap, does it support a roadmap item or is it tangential?
- Does it advance the product toward the stated success criteria for the current phase?
- Does it avoid introducing scope or complexity that would delay roadmap priorities?

### Red Flags

**In specs:**
- Features from Phase 4-5 being built during Phase 1-2 without justification
- "Nice to have" features that consume capacity needed for must-have items
- Features that serve a different product vision than the one in `mission.md`
- Infrastructure work that doesn't unblock any current roadmap item

**In code:**
- Implementation of capabilities not requested by any spec or roadmap item
- Premature optimization for scale problems the product hasn't reached
- Integration points for external services not on the roadmap
- Admin features for workflows that don't exist yet

### Evaluation

Ask: "Does completing this bring us closer to the current phase's success criteria, or does it pull us sideways?"
