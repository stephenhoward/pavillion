---
name: bead-state-assessment
description: Classify a bead's lifecycle state and decide the next phase. Use this skill when routing a bead through shape/decompose/analyze/execute, when deciding whether a bead should be split, or when an orchestrator needs a deterministic verdict on bead readiness before dispatching work.
---

# Bead State Assessment

This skill classifies any bead into one of seven lifecycle states and recommends
the next phase. Its prose documents the state machine for humans; its scripts
deliver deterministic JSON verdicts for orchestrators.

Consumers: `/process-backlog`, `/plan`, `/spawn-bead-workers`,
`/analyze-bead`.

## The state machine

A bead moves through these states, in order:

```
unshaped -> shaped -> advised -> decomposed -> analyzed -> executing -> complete
```

Each state is a milestone — a durable property of the bead — not a status
flag. A bead's state is the highest milestone it has reached. The `bd status`
field (OPEN / IN_PROGRESS / CLOSED) overrides the milestone walk for the two
terminal states (`executing`, `complete`) because those are real-time facts,
not document-structure signals.

### State definitions

| State | Signal |
|---|---|
| `unshaped` | DESCRIPTION is missing, empty, or the bead lacks one of DESIGN / ACCEPTANCE CRITERIA sections. This is a raw idea, not yet ready for any review. |
| `shaped` | DESCRIPTION is present and non-empty, AND the bead has both DESIGN and ACCEPTANCE CRITERIA sections. Advisors can meaningfully review it. |
| `advised` | The bead's notes contain "Advisory Review". `/plan`'s ADVISE phase has run advisors over the shaped fields and recorded a verdict line per advisor. The bead has cleared the pre-code review bar. |
| `decomposed` | The bead has a CHILDREN section listing at least one child bead. Epics live here once they have leaves. |
| `analyzed` | The bead's notes contain "Implementation Context". `/analyze-bead` has enriched the notes with files to modify, relevant tests, skills to apply, standards to follow, and acceptance criteria. An implementer can now be dispatched. |
| `executing` | Bead's status is IN_PROGRESS. Work is underway. |
| `complete` | Bead's status is CLOSED. Work is done. |

### Why these signals

The signals come from the artifacts each phase produces, not from labels or
metadata. A bead is "shaped" because a human (or an auto-shape subagent)
wrote a design and acceptance criteria — those are the visible output of
shaping. A bead is "advised" because `/plan`'s ADVISE phase wrote an
Advisory Review block to notes — that is the visible output of advisory
review. A bead is "analyzed" because `/analyze-bead` wrote an Implementation
Context block — that is the visible output of analysis. Classification by
artifact means state cannot drift out of sync with reality.

## Next-phase decision tree

Given a bead's state, the orchestrator picks the next phase:

```
state == unshaped     -> run /plan (or auto-shape subagent) to populate
                         DESCRIPTION, DESIGN, ACCEPTANCE
state == shaped       -> run advisors on the shaped bead (ADVISE phase);
                         on clean verdict, state advances to advised
state == advised      -> if sizing check recommends decomposition, run
                         /decompose-bead next; otherwise run /analyze-bead
state == decomposed   -> walk to each leaf child; apply this decision tree
                         to every leaf whose state is < analyzed. When every
                         leaf is analyzed, the epic is ready to spawn workers
state == analyzed     -> dispatch an implementer (single-leaf) or spawn a
                         worker wave (epic with analyzed leaves)
state == executing    -> wait; the bead is already being worked on
state == complete     -> skip; nothing to do
```

The `missing_phases` array returned by `bd-state.sh` is the direct input
to this tree. If `analyzed` appears in `missing_phases`, the next phase is
`/analyze-bead`. If `decomposed` appears, sizing dictates whether
decomposition is needed. If `advised` appears, advisors have not yet
reviewed the bead.

## Sizing heuristic: when should a bead be decomposed?

The `bd-sizing-check.sh` script applies a **2-of-3** rule over the bead's
DESCRIPTION + DESIGN text. If at least two of these criteria trigger, the
bead should be decomposed before analysis:

1. **4+ files implied.** The description mentions at least four distinct
   file paths (by extension — `.ts`, `.vue`, `.scss`, `.sql`, etc.). A bead
   that touches this many files usually crosses layer boundaries.
2. **Multi-domain span.** The description activates more than one of these
   keyword domains: backend (API / service / entity / migration),
   frontend (Vue / component / Pinia / site / client / SCSS), translation
   (locale / i18n), or federation (ActivityPub / inbox / outbox / actor).
3. **Multiple independent deliverables.** The description lists at least
   four bullet / numbered items that are independent of each other.

A bead that hits only one criterion is usually a cohesive leaf. A bead that
hits two or three should be split so each child stays within a single
domain and a single cohesive deliverable — leaf size is what an implementer
can complete in a single session without running out of context.

## Implementation

Functions live in `.claude/orchestrators/lib/helpers.ts`:

### `bdState(beadId, deps)`

Returns `{state, missing_phases[], reasons[]}`. `missing_phases` lists the
milestones the bead has not yet reached (its content drives the next-phase
decision tree). `reasons` documents which signals triggered, so the
orchestrator and human reviewers can see the justification.

Example: a decomposed epic that has been through advisory review produces
`{"state":"decomposed","missing_phases":["analyzed"],"reasons":["has non-empty DESCRIPTION","has DESIGN section","has ACCEPTANCE CRITERIA section","notes contain Advisory Review","has CHILDREN with at least one child bead"]}`.

Note: a bead can be classified as `decomposed` without ever entering
`advised` if children were added before advisors ran. State is the highest
milestone reached, not a strict sequence — but the natural `/plan` flow
progresses shaped → advised → decomposed for each cohort.

### `bdEnrichmentCheck(beadId, deps)`

Returns `true` if the bead's notes contain "Implementation Context", `false` otherwise. Implementer subagents use this as a pre-flight assertion per the `implementer-prompt-template` skill's refusal protocol. Keeping it separate from `bdState()` means the implementer refusal check is a simple boolean, not a JSON parse.

### `bdSizingCheck(beadId, deps)`

Returns `{needs_decomposition, reasons[]}` per the 2-of-3 heuristic above.
The `reasons` array captures which criteria triggered and by how much, so
the surfacing prompt in `/analyze-bead` can explain *why* decomposition is
recommended.

## Tests

Tests are co-located with the orchestrator codebase in `.claude/orchestrators/lib/__tests__/`. Fixtures capture `bd show` output for various bead states; the test suite verifies that each function correctly classifies state, identifies missing phases, detects enrichment, and applies the sizing heuristic.

## Cross-references

- `epic-bead-workflow` — bead semantics and the state progression this
  skill classifies against
- `bead-backlog-selection` — consumes `bd-state.sh` to pick next actions
  on ready beads
- `implementer-prompt-template` — uses `bd-enrichment-check.sh` as its
  pre-flight refusal gate
