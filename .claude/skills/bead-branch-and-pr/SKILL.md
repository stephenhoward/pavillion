---
name: bead-branch-and-pr
description: Orchestrator-internal helper functions that turn a bead into a branch, commit message, and PR body. Use when an orchestrator (or test that simulates one) needs to call branchName, commitMsg, prBody, or gitSafeToStart programmatically. NOT a source of truth for git or PR conventions — see the git-workflow skill for those.
---

# Bead Branch and PR Helpers

This skill documents the deterministic helper functions that orchestrators call when they need to turn a bead into git artifacts. The conventions those artifacts must follow are defined elsewhere — this skill is purely about the helper API.

**Source of truth for git/PR conventions:** the `git-workflow` skill at `.claude/skills/git-workflow/`. That skill defines branch naming, commit format, PR template, and the foundational principle that GitHub artifacts must be self-contained for GitHub readers (no bead IDs in branches, commits, or PR bodies).

## When to use

Invoke this skill when:

- An orchestrator phase needs to derive a branch name, commit message, or PR body from bead metadata.
- A test fixtures the helpers' output and needs to know the call signature.
- You are evolving one of the four helpers and need to keep the implementation aligned with `git-workflow`.

Do **not** use this skill to look up git or PR conventions. For those, read `git-workflow/branches.md`, `commits.md`, `pull-requests.md`, or `releases.md` directly.

## The four helpers

The functions live in `.claude/orchestrators/lib/helpers.ts` and are pure (no I/O) except for `gitSafeToStart`, which shells out to `git`.

### `branchName(title, issueType)`

Returns `<type>/<kebab-title>`, capped at 60 characters total. The type prefix maps from the bead's `issue_type`:

| `issue_type` | Branch prefix |
|--------------|---------------|
| `bug`        | `fix/`        |
| `feature`    | `feat/`       |
| `epic`       | `feat/`       |
| `task`       | `chore/`      |
| (anything else) | `chore/`   |

Bead IDs are not embedded in the output. The orchestrator's bookkeeping of which bead a branch belongs to is tracked in its run-context, not in the branch name.

### `commitMsg(summary, issueType, scope?)`

Returns a conventional-commit header — `<type>(<scope>): <summary>` or `<type>: <summary>` when no scope is given. The same `issue_type → type` map as `branchName` applies. Newlines and runs of whitespace in `summary` are flattened so multi-line input still produces a one-line header.

Bead IDs are not embedded in the output. GitHub's squash-merge UI auto-appends the `(#PR)` form when the branch lands on `main`.

### `prBody(title, description)`

Returns a markdown body with the three sections defined by the `git-workflow` PR template:

```markdown
## Motivation

<description, or title if description is empty>

## Approach

<title>

## Validation

- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run build`
- [ ] Relevant e2e specs passing via build-guardian
```

No Summary section, no Beads-closed list, no Test plan — those would either duplicate template content or leak local tracker references into a GitHub-visible artifact.

### `gitSafeToStart(deps?)`

Returns `{ ok: boolean, reason?: string }`. The orchestrator calls this at the branch-creation step as a narrow re-check (clean tree + on `main`). It is intentionally cheaper than the full `preflight()` that runs at the start of `/process-backlog`.

The expected main-branch name defaults to `main` and can be overridden by the `GIT_SAFE_MAIN_BRANCH` env var for test rigs.

## Push gate: build-guardian before `git push`

A branch may not be pushed to `origin` until the wave's build-guardian agent has reported PASS. This is enforced by the orchestrator's pipeline, not by these helpers, but it is documented here because it is the rule that closes the loop on safe branch handling:

1. Implementers land commits on the branch.
2. Per-bead auditors run.
3. Build-guardian runs once per wave across all committed changes.
4. Only after build-guardian PASS does the orchestrator `git push -u origin <branch>` and open the PR.

If build-guardian reports FAIL, do not push. Fix locally, re-run build-guardian, and push only once it passes.

## Testing

Tests live alongside the orchestrator codebase at `.claude/orchestrators/test/unit/helpers.test.ts`. The suite covers each helper's pure-function behavior and the spawn-mocking dance for `gitSafeToStart`. Helpers must not embed bead IDs in any rendered output — the tests assert this directly.

## Related skills

- `git-workflow` — canonical source for branch, commit, PR, and release conventions. These helpers exist to produce output that conforms to it.
- `bead-backlog-selection` — owns the full `preflight()` that this skill's `gitSafeToStart` re-checks narrowly.
- `bead-wave-orchestration` — consumes these helpers when the orchestrator is about to set up a branch or open a PR.
- `epic-bead-workflow` — source of truth for how beads relate to branches and PRs at the workflow level.
