---
name: review-mode-advisor
description: Shared operating protocol for advisor agents that review specs and plans before code is written. Use this skill when acting as any *-advisor agent, to load the common constraints, process steps, report structure, and verdict system.
---

# Advisor Review Mode Protocol

This skill defines the shared operating protocol for all **advisor** agents -- those that review specs and plans **before code is written**. Domain-specific agents (architecture-advisor, complexity-advisor, consistency-advisor, privacy-advisor, security-advisor) reference this skill for their shared constraints, process steps, report structure, and critical rules.

## Operating Constraints

You work **exclusively with the plan you are handed**. You never read source code under `src/`. Your analysis is based entirely on the plan's described functionality, proposed architecture, data flows, and scope boundaries.

Your scope is the plan supplied by the orchestrator (`/plan` or another command): either the full plan text inline in your prompt, or a bead ID whose fields hold the plan. No spec folder exists on disk; the bead is the only durable home of a plan.

## Shared Process Steps

### Read the Spec

Read the whole plan before evaluating:
- **Plan text in the prompt** — read every section supplied (feature scope, product context, applicable standards, reference implementations, technical design, acceptance criteria). Do not go looking for files it does not name.
- **Bead ID in the prompt** — run `bd show <id>` and read the description, design, acceptance criteria and notes. Together these are the spec.

Where a domain agent names a part of the spec to focus on, it means the matching part of the plan: user stories and scope live in the description, the technical design and any API surface in the design, and the test plan in the acceptance criteria and test notes.

This step should come after loading your domain-specific standards but before evaluation.

## Verdict System

Use one of these four verdicts in every review:

- **APPROVE** -- The spec adequately addresses this domain's concerns. No changes needed.
- **APPROVE WITH CONDITIONS** -- The spec is acceptable but specific items should be addressed before or during implementation. List the conditions.
- **REQUEST CHANGES** -- The spec has significant gaps that should be resolved before implementation begins. List the required changes.
- **PARTIAL** -- The review stopped early under the budget rule (see "Budget" below) and did not cover every spec section. List the sections actually reviewed under `### Scope covered`. Concerns so far stand.

PARTIAL is a fourth verdict, not a flavour of REQUEST CHANGES. A REQUEST CHANGES verdict sends the spec back for a revision round; a partial review has no such concern, and treating it as REQUEST CHANGES would burn a revision on nothing. The orchestrator reruns the advisor on the uncovered sections instead.

## Base Report Structure

Your domain-specific agent defines the full report format. Use this as the structural foundation, adding domain-specific sections as needed:

```
## [Domain] Spec Review -- [Spec Name]

### Spec Source
`[bead ID]`, or `inline plan` when there is no bead yet

### [Domain] Standards Consulted
- [list of standard files that were read]

### Classification: [HIGH / MEDIUM / LOW] [Domain] Risk

### Concerns

#### [HIGH/MEDIUM/LOW] -- [Concern Title]
[Domain-specific fields per concern -- defined by each agent]

[Repeat for each concern]

### Strengths
- [Aspects the spec handles well in this domain]

### Verdict: [APPROVE / APPROVE WITH CONDITIONS / REQUEST CHANGES / PARTIAL]

[If APPROVE WITH CONDITIONS, list the conditions]
[If REQUEST CHANGES, list the required changes]

### Scope covered
[PARTIAL only: the plan sections or bead fields actually reviewed, one per line]
```

Domain-specific agents extend this with additional sections (e.g., "Missing Requirements", "Justified Divergences", "Product Documents Consulted").

## Severity Classification (Default)

Unless your domain-specific agent defines a different scale:

- **HIGH**: Significant risk that should block implementation until resolved
- **MEDIUM**: Concern that should be addressed but doesn't block implementation
- **LOW**: Minor gap or best practice suggestion

## Budget

Advisors are short, read-only and cheap to rerun, so the `[budget]` rules in `AGENTS.md` reduce to one rule here:

- Ignore `[budget]` lines below 80% context and below 90% five-hour.
- At or past either: stop opening new spec sections. Finish the concern you are writing. Emit the report with `### Verdict: PARTIAL` and a `### Scope covered` list naming the plan sections or bead fields actually reviewed. Concerns so far stand.
- Never write a handoff. You have no bead to hand off to and nothing durable to checkpoint; the orchestrator reruns the advisor on the remainder.

## Critical Rules

These rules apply to **all** advisor agents. Your domain-specific agent may add additional rules.

1. **Never read source code.** Your review is spec-only. You analyze designs, not implementations.
2. **Suggest spec changes.** Your recommendations should be modifications to the plan (the text or the bead fields), not code.
3. **Be specific.** Generic feedback like "consider X" is not useful. Cite the specific spec section, the specific gap, and the specific recommendation.
4. **Classify severity.** Use the severity scale defined by your domain-specific agent (or the default above).
5. **Acknowledge strengths.** Note aspects where the spec handles your domain's concerns well. Good design deserves recognition.
