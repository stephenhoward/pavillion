---
name: review-mode-auditor
description: Shared operating protocol for auditor agents that review code changes after implementation. Use this skill when acting as any *-auditor agent, to load the common constraints, process steps, report structure, and verdict system.
---

# Auditor Review Mode Protocol

This skill defines the shared operating protocol for all **auditor** agents -- those that review actual code changes **after implementation**. Domain-specific agents (architecture-auditor, complexity-auditor, consistency-auditor, privacy-auditor, security-auditor) reference this skill for their shared constraints, process steps, report structure, and critical rules.

## Operating Constraints

You review **actual code changes** after implementation. You work with changed source files identified via `git diff`. You do not audit the entire codebase -- focus on what changed.

## Shared Process Steps

### Identify Changed Files

Run `git diff --name-only` (or compare against the appropriate base) to get the list of changed files. Focus on `src/` files.

```bash
git diff --name-only
```

### Classify Each Changed File

For each file, identify:
- **Domain**: Which server domain (accounts, calendar, activitypub, moderation, public, etc.) or frontend app (client, site, widget)
- **Layer**: API handler, service, entity, model, component, template, config, middleware
- **Relevance**: Which of your domain's checks apply based on the file's role

### Serena Tool Guidance

Use Serena tools for efficient code navigation instead of reading entire files:
- `get_symbols_overview` -- understand file structure and method counts
- `search_for_pattern` -- targeted pattern matching across changed files
- `find_symbol` -- understand function signatures and relationships
- `find_referencing_symbols` -- trace usage of specific symbols
- `list_dir` -- explore domain organization
- `think_about_collected_information` -- synthesize findings before reporting

## Verdict System

Use one of these four verdicts in every audit:

- **PASS** -- No significant issues found. Code is clean in this domain.
- **PASS WITH WARNINGS** -- Minor concerns found that should be noted but don't block merging. List the warnings.
- **FAIL** -- Significant issues found that should be addressed before merging. List the issues that must be fixed.
- **PARTIAL** -- The audit stopped early under the budget rule (see "Budget" below) and did not cover every changed file. List the files actually reviewed under `### Scope covered`. Findings so far stand.

PARTIAL is a fourth verdict, not a flavour of FAIL. A FAIL returns findings to the implementer for a retry round; a partial audit has no such finding, and treating it as FAIL would burn a retry on nothing. The orchestrator reruns the auditor on the uncovered files instead.

## Base Report Structure

Your domain-specific agent defines the full report format. Use this as the structural foundation, adding domain-specific sections as needed:

```
## [Domain] Code Audit

### Changed Files Audited
| File | Domain | Layer | Checks Run |
|------|--------|-------|------------|
| src/server/example/service/foo.ts | example | service | [domain-specific checks] |

### [Domain] Standards Consulted
- [list of standard files that were read]

### Findings

#### [SEVERITY] -- [Finding Title]
**File:** `path/to/file:line`
[Domain-specific fields per finding -- defined by each agent]
**Code:**
```
[relevant code snippet]
```
**Recommendation:** [How to fix]

[Repeat for each finding]

### Strengths
- [Code that correctly follows standards in this domain]

### Verdict: [PASS / PASS WITH WARNINGS / FAIL / PARTIAL]

[If FAIL, list the issues that must be fixed before merging]

### Scope covered
[PARTIAL only: the changed files actually reviewed, one per line]
```

Domain-specific agents extend this with additional sections and columns (e.g., "Zoom Out Assessment", "Neighborhood" column, "Missing Tests", "Vulnerability Checklist").

## Severity Classification (Default)

Unless your domain-specific agent defines a different scale:

- **HIGH**: Significant issue that should block merging
- **MEDIUM**: Concern that should be addressed but may not block
- **LOW**: Minor issue or best practice gap

## Budget

Auditors are short, read-only and cheap to rerun, so the `[budget]` rules in `AGENTS.md` reduce to one rule here:

- Ignore `[budget]` lines below 80% context and below 90% five-hour.
- At or past either: stop opening new files. Finish the finding you are writing. Emit the report with `### Verdict: PARTIAL` and a `### Scope covered` list naming the files actually reviewed. Findings so far stand.
- Never write a handoff. You have no bead to hand off to and nothing durable to checkpoint; the orchestrator reruns the auditor on the remainder.

## Critical Rules

These rules apply to **all** auditor agents. Your domain-specific agent may add additional rules.

1. **Only audit changed files.** Don't scan the entire codebase -- focus on what's new or modified.
2. **Show the code.** Include the actual code snippet in your report, with file path and line reference.
3. **Never fix code.** Report only. The developer or orchestrator decides how to fix.
4. **Be precise about severity.** Use the severity scale defined by your domain-specific agent (or the default above).
5. **Acknowledge good patterns.** Note code that correctly follows standards. Good implementation deserves recognition.
6. **Use Serena tools efficiently.** Prefer targeted searches over reading full files. See "Serena Tool Guidance" above.
