---
name: bead-branch-and-pr
description: Deterministic git and gh-stack tooling for turning beads into branches and PRs. Use when an orchestrating agent needs to create a stack level, submit a branch, plan dependency chains, or run the post-merge sync programmatically. NOT a source of truth for git or PR conventions — see the git-workflow skill for those.
---

# Bead Branch and PR Tooling

This skill documents the deterministic tooling that orchestrating agents call
when they need to turn beads into git artifacts. The conventions those
artifacts must follow are defined elsewhere — this skill is purely about the
tool API.

**Source of truth for git/PR conventions:** the `git-workflow` skill at
`.claude/skills/git-workflow/`. That skill defines branch naming, commit
format, PR template, stacking rules and `gh stack` command patterns
(`stacking.md`), and the foundational principle that GitHub artifacts must be
self-contained for GitHub readers (no bead IDs in branches, commits, or PR
bodies).

## When to use

Invoke this skill when:

- An orchestrating agent needs to create a stack level, submit a branch,
  plan an epic's dependency chains, or verify the tree is safe to branch
  from.
- A test fixtures the tool's output and needs to know the call signature.
- You are evolving the stack tool and need to keep it aligned with
  `git-workflow`.

Do **not** use this skill to look up git or PR conventions. For those, read
`git-workflow/branches.md`, `commits.md`, `pull-requests.md`, or
`releases.md` directly. Branch names, commit messages, and PR bodies are
composed by the agent following those conventions — there is no templating
tool for them.

## The tool

Commands live in `.claude/tools/stack.ts` (implementation:
`.claude/tools/lib/stack.ts`). All emit JSON to stdout. This is the ONLY
place gh-stack operations are implemented (anti-drift rule); command shapes
are pinned to gh-stack 0.0.8 spike-verified behavior.

### `stack.ts safe-to-start [parent-branch]`

Narrow pre-branch check: inside a work tree, clean tree, HEAD at the base
the next branch will be cut from. Without `parent-branch`, the base is
`origin/<main>` (override the branch name via `GIT_SAFE_MAIN_BRANCH`); with
it, HEAD is compared against the **local** parent branch tip — a mid-chain
stack parent may not exist on origin yet. Returns `{ok, reason?}`; exit 0/1
mirrors `ok`.

### `stack.ts plan '<json>'`

Pure chain planner. Input:
`{"beads": ["id", ...], "edges": [{"blocker", "blocked", "dependencyType"?}, ...]}`
— the sibling bead set and the bd "blocks" edges among them. Returns
`{chains, flat, warnings}`: an ordered forest of blocker-first chains.
Non-linear graphs (cycle, fork, join) fall back to a flat all-singletons
plan with warnings. Independent beads are singleton chains.

### `stack.ts create <branch> <parent> --chained|--single`

Create a branch for one stack level (or a plain single-bead branch).
Routing: mid-chain (`parent` is a stack level) → `gh stack add`; chain head
(`parent` = trunk, `--chained`) → `gh stack init --base`; single (`--single`)
→ plain `git checkout -b`. Precondition: `branch` follows
`git-workflow/branches.md`; for the mid-chain case the parent must be the
current stack top and checked out.

### `stack.ts submit <branch> --chained|--single`

Submit a stack level and open/update its PR. Chains: `gh stack submit
--auto --open` plus a `gh pr ready` sweep (no-draft backstop). Singles:
`git push -u origin` + `gh pr create --fill`. Either way the caller
canonicalizes title/body with `gh pr edit` afterwards, per
`git-workflow/pull-requests.md`.

### `stack.ts sync`

Post-merge catch-up: `gh stack sync --prune` with structured results —
`{ok, exitCode, conflicted, featureDisabled, rawOutput}`. Exit code 3 =
rebase conflict; 9 = private-preview feature disabled (clean hard stop).
`/restack` is a thin wrapper over this command.

## Push gate: build-guardian before submit

A branch may not be submitted (pushed / PR opened) until build-guardian has
reported PASS for that branch **at its stack position** — every stack level
is independently green (invariant: `git-workflow/stacking.md`). This is
enforced by the orchestrating agent's pipeline, not by the tool, but it is
documented here because it is the rule that closes the loop on safe branch
handling:

1. Implementers land commits on the level's branch.
2. Per-bead auditors run.
3. Build-guardian runs once per stack level, before that level's submit
   (lifecycle: `bead-wave-orchestration`).
4. Only after build-guardian PASS does the agent submit the branch and
   finalize the PR (command patterns: `git-workflow/stacking.md`).

If build-guardian reports FAIL, do not submit. Fix locally, re-run
build-guardian, and submit only once it passes.

## Testing

Tests live at `.claude/tools/test/stack.test.ts` (run with
`npx vitest run --config .claude/tools/vitest.config.ts`). The suite covers
the pure planner, the spawn-mocked CLI wrappers, and cwd forwarding for
worktree-hosted chains.

## Related skills

- `git-workflow` — canonical source for branch, commit, PR, and release
  conventions. This tool exists to produce output that conforms to it.
- `bead-wave-orchestration` — consumes these commands when a wave is about
  to set up a branch or open a PR.
- `epic-bead-workflow` — source of truth for how beads relate to branches
  and PRs at the workflow level.
