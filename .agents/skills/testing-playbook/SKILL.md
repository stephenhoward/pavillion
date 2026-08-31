---
name: Testing Playbook
description: Pavillion test quality standards. Use this skill when evaluating specs or code for test coverage issues including missing test types, weak assertions, over-testing, under-testing, and test maintainability concerns.
---

# Testing Playbook

This Skill provides test quality standards specific to the Pavillion codebase. Use it when reviewing specs for test strategy, auditing code for test quality, or checking that test suites provide meaningful coverage without unnecessary bloat.

## Topic Files

| If the spec or code involves... | Read this file |
|--------------------------------|----------------|
| Which test types to use (unit, integration, e2e), test tier selection, testing boundaries | [./test-tiers.md](./test-tiers.md) |
| What behavior to validate, assertion quality, happy path vs edge cases, coverage targeting | [./coverage-strategy.md](./coverage-strategy.md) |
| Test size, maintainability, fixture patterns, DRY vs clarity tradeoffs in tests | [./test-maintainability.md](./test-maintainability.md) |

## Instructions

The companion files contain **Established Convention**, **Examples**, **Anti-Patterns**, and **Known Drift** sections for each area. Read only the files relevant to your current task.

When reviewing:

1. Identify which topics are relevant to the spec or code under review
2. Read only the relevant companion files
3. Check the spec or code against each file's **Established Convention** and **Anti-Patterns** sections
4. When a concern is found, apply the **Testing Divergence Framework** below before flagging

## Testing Divergence Framework

Not all testing variation is a problem. Before flagging an inconsistency, check whether it meets one of these criteria:

### 1. High-Risk Code Path

The code handles money, authentication, federation trust, or data integrity. Extra tests -- including edge cases and redundant coverage at multiple tiers -- are justified for code where a bug has outsized impact.

**Test:** "Would a bug here lose data, money, or security? Does the extra test catch a failure mode that other tests don't?"

### 2. Unstable External Boundary

The code integrates with an external system (Stripe, ActivityPub peers, S3, SMTP) whose behavior is outside our control. Extra integration or e2e coverage is justified to catch contract changes.

**Test:** "Does this test protect against behavior changes in a system we don't control?"

### 3. Previously-Broken Code Path

The code has a history of regressions (documented in git history or beads). A regression test is justified even if it appears to duplicate existing coverage.

**Test:** "Is this test specifically preventing a recurrence of a known past bug?"

### 4. Complex State Machine or Branching Logic

The code has many conditional branches, state transitions, or combinatorial inputs where systematic coverage of branches is more valuable than the usual "happy path + key error" approach.

**Test:** "Does this code have enough branches that selective testing would leave meaningful gaps?"

### Using the Framework

1. **Identify the concern** -- is there too much testing, too little, or the wrong kind?
2. **Check the four criteria** -- does any criterion apply?
3. **If yes** -- note the divergence but classify it as "justified" with the criterion
4. **If no** -- flag it as a concern that should be corrected
5. **If uncertain** -- flag it as "potential concern, verify intent" and let the developer decide
