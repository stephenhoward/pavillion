---
name: bead-branch-and-pr
description: Orchestrator-internal helper functions that turn a bead into a branch, commit message, and PR body. Use when an orchestrator (or test that simulates one) needs to call branchName, commitMsg, prBody, or gitSafeToStart programmatically. NOT a source of truth for git or PR conventions — see the git-workflow skill for those.
---

# Bead Branch and PR Helpers

This skill documents the deterministic helper functions that orchestrators call when they need to turn a bead into git artifacts. The conventions those artifacts must follow are defined elsewhere — this skill is purely about the helper API.

**Source of truth for git/PR conventions:** the `git-workflow` skill at `.claude/skills/git-workflow/`. That skill defines branch naming, commit format, PR template, stacking rules and `gh stack` command patterns (`stacking.md`), and the foundational principle that GitHub artifacts must be self-contained for GitHub readers (no bead IDs in branches, commits, or PR bodies).

## When to use

Invoke this skill when:

- An orchestrator phase needs to derive a branch name, commit message, or PR body from bead metadata.
- A test fixtures the helpers' output and needs to know the call signature.
- You are evolving one of the four helpers and need to keep the implementation aligned with `git-workflow`.

Do **not** use this skill to look up git or PR conventions. For those, read `git-workflow/branches.md`, `commits.md`, `pull-requests.md`, or `releases.md` directly.

## The helpers

The functions live in `.claude/orchestrators/lib/helpers.ts`. `branchName`, `commitMsg`, and `prBody` are pure (no I/O); `gitSafeToStart` shells out to `git`, and the stack helpers shell out to `gh`/`gh stack` (routing singles to plain `git`/`gh` — see `git-workflow/stacking.md`).

### `branchName(title, issueType)`

Returns `<type>.<kebab-title>`, capped at 60 characters total. The type prefix maps from the bead's `issue_type`:

| `issue_type` | Branch prefix |
|--------------|---------------|
| `bug`        | `fix.`        |
| `feature`    | `feat.`       |
| `epic`       | `feat.`       |
| `task`       | `chore.`      |
| (anything else) | `chore.`   |

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

### `gitSafeToStart(parentBranch?, deps?)`

Returns `{ ok: boolean, reason?: string }`. The orchestrator calls this at the branch-creation step as a narrow re-check (clean tree + HEAD current with the branch base). It is intentionally cheaper than the full `preflight()` that runs at the start of `/process-backlog`.

Without `parentBranch`, HEAD is compared against `origin/<mainBranch>` (the trunk case). With `parentBranch` (stacking), HEAD is compared against the **local** parent branch tip — a mid-chain parent may not exist on origin yet. Semantics and rationale: `git-workflow/stacking.md` and the jsdoc in `helpers.ts`.

The expected main-branch name defaults to `main` and can be overridden by the `GIT_SAFE_MAIN_BRANCH` env var for test rigs.

### Stack helpers: `stackPlan`, `stackCreate`, `stackSubmit`, `syncAndRestack`

The chain planner and the `gh stack` wrappers, also in `.claude/orchestrators/lib/helpers.ts` — the only place `gh stack` operations are implemented. Conventions and command patterns live in `git-workflow/stacking.md`; the jsdoc on each helper records the gh-stack-0.0.8-verified behavior. Signatures:

- `stackPlan(beads, dependencyEdges)` — pure; plans dependency-chain stacks from an epic's child beads and the bd "blocks" edges among them. Returns an ordered forest of chains as `{ chains, flat, warnings }`; a cycle or any cross-chain join falls back to a flat no-stack plan with a warning. (The edge parameter is named `dependencyEdges`, never `deps` — `deps` is reserved codebase-wide for `SpawnDeps` injection.)
- `stackCreate(branch, parent, chained, deps?)` — routes by `chained` (from the caller's `stackPlan` result) and `parent`: chain head off trunk → `gh stack init`; parent is a stack branch → `gh stack add`; single off trunk → plain `git checkout -b`. Precondition (asserted in tests, not validated at runtime): `branch` is a `branchName()`-produced name.
- `stackSubmit(branch, chained, deps?)` — chains submit as ready-for-review (non-draft) PRs via `gh stack`; singles use the plain `git push` + `gh pr create` path. See `git-workflow/stacking.md` for the exact flags.
- `syncAndRestack(deps?)` — post-merge sync; runs `gh stack sync --prune` and returns structured `{ ok, exitCode, conflicted, featureDisabled, rawOutput }` results so callers can decide re-validation. `conflicted` is true on exit code 3 (rebase conflict); `featureDisabled` is true on exit code 9 (private-preview feature disabled for this repo).

The CLI-shelling helpers take the trailing `deps: SpawnDeps = {}` used by every CLI-shelling helper in the file; `stackPlan` is pure and takes no `deps`.

## Push gate: build-guardian before submit

A branch may not be submitted (pushed / PR opened) until build-guardian has reported PASS for that branch **at its stack position** — every stack level is independently green (invariant: `git-workflow/stacking.md`). This is enforced by the orchestrator's pipeline, not by these helpers, but it is documented here because it is the rule that closes the loop on safe branch handling:

1. Implementers land commits on the level's branch.
2. Per-bead auditors run.
3. Build-guardian runs once per stack level, before that level's submit (lifecycle: `bead-wave-orchestration`).
4. Only after build-guardian PASS does the orchestrator submit the branch and finalize the PR (command patterns: `git-workflow/stacking.md`).

If build-guardian reports FAIL, do not submit. Fix locally, re-run build-guardian, and submit only once it passes.

## Testing

Tests live alongside the orchestrator codebase at `.claude/orchestrators/test/unit/helpers.test.ts`. The suite covers each helper's pure-function behavior and the spawn-mocking dance for `gitSafeToStart`. Helpers must not embed bead IDs in any rendered output — the tests assert this directly.

## Related skills

- `git-workflow` — canonical source for branch, commit, PR, and release conventions. These helpers exist to produce output that conforms to it.
- `bead-backlog-selection` — owns the full `preflight()` that this skill's `gitSafeToStart` re-checks narrowly.
- `bead-wave-orchestration` — consumes these helpers when the orchestrator is about to set up a branch or open a PR.
- `epic-bead-workflow` — source of truth for how beads relate to branches and PRs at the workflow level.
