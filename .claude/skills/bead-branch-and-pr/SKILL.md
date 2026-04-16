---
name: bead-branch-and-pr
description: Git branch, commit, and PR conventions for bead-scoped work. Use when creating a branch for a bead, writing commit messages that reference a bead id, drafting a PR that closes one or more beads, or verifying the working tree is safe to start new bead work.
---

# Bead Branch and PR Skill

This skill captures the git and GitHub conventions used when turning a bead (or a chain of beads) into shippable work. It pairs prose guidance with four deterministic scripts that do the actual formatting so every branch, commit, and PR body is generated the same way, whether a human or an orchestrator is running the workflow.

The scripts live next to this file and are invoked directly:

- `branch-name.sh <bead-id> [--type-override=<prefix>]`
- `commit-msg.sh <bead-id> <summary> [scope]`
- `pr-body.sh <bead-id> [additional-bead-id ...]`
- `git-safe-to-start.sh`

All scripts use `bd show --json <id>` under the hood (overridable via `BD_SHOW_CMD` for tests) and fail loudly on missing arguments (exit 2) or unknown beads (exit 3).

## Branch naming

Branches follow the pattern:

```
<prefix>/<kebab-title>-<bead-id-with-dashes>
```

The prefix is derived from the bead's `issue_type` so that the branch name hints at the kind of change that's landing. It also lines up with the conventional-commit prefixes used in commit messages, keeping the vocabulary consistent from branch → commit → PR.

| Bead type  | Branch prefix | Conventional commit type |
|------------|---------------|--------------------------|
| `bug`      | `fix/`        | `fix`                    |
| `feature`  | `feat/`       | `feat`                   |
| `epic`     | `feat/`       | `feat`                   |
| `task`     | `chore/`      | `chore`                  |
| (unknown)  | `chore/`      | `chore`                  |

If a task is really an enhancement or refactor rather than housekeeping, override the prefix explicitly:

```bash
./branch-name.sh pv-9cfj.3 --type-override=refactor
# -> refactor/<kebab-title>-<id>
```

**Rules enforced by `branch-name.sh`:**

- Kebab-case the bead title: lowercase, any run of non-alphanumerics collapses to a single hyphen, leading/trailing hyphens stripped.
- Replace dots in the bead id (`pv-9cfj.3` → `pv-9cfj-3`) so the branch name is safe for `git rev-parse --abbrev-ref` and wildcard globs.
- Total branch name length is capped at 60 characters. When the title is too long, only the kebab-title segment is truncated; the prefix and id slug are always preserved, and a trailing hyphen left over from mid-word truncation is trimmed.
- Output is deterministic: the same bead always produces the same branch name.

## Commit message format

Commit messages follow the conventional-commit shape with a `(pv-xxxx)` id suffix that ties the commit to a bead. This matches the existing git history — see commit `a810e16`:

```
fix(events): persist and display event accessibility info (pv-xhzn)
```

**`commit-msg.sh` emits exactly one line:**

```
<type>(<scope>): <summary> (<bead-id>)
```

The scope parenthetical is omitted when no scope is provided:

```
<type>: <summary> (<bead-id>)
```

The `<type>` is derived from the bead's `issue_type` using the same mapping as branch naming (`bug → fix`, `feature → feat`, `epic → feat`, `task → chore`). The `<summary>` is flattened to a single line (newlines and runs of whitespace collapse to single spaces) so multi-line summaries passed in from orchestrators don't break the commit header.

### Two commit conventions, don't confuse them

Two commit shapes appear in this repo's history, and they mean different things:

1. **In-branch commits:** individual commits on a feature branch use the `(pv-xxxx)` suffix. This is what `commit-msg.sh` produces. Example:

   ```
   fix(calendar): preserve repost-target context in reassign-categories dialog (pv-xxxx)
   ```

2. **Merge commits on `main`:** GitHub's squash/merge UI appends `(#PR)` automatically. Example:

   ```
   fix(widget): bring event detail page to parity with public site (#199)
   ```

When writing commits directly, **always use `(pv-xxxx)`** — let GitHub add the `(#PR)` form when the branch merges.

### Never add assistant trailers

Commit messages must not contain `Co-authored-by: Claude`, `Claude-Code`, or any other assistant-generated trailer. The script never emits one, and human commit bodies must not add one either.

## PR body template

`pr-body.sh <primary-bead-id> [additional-bead-ids...]` renders a PR body in markdown with three sections:

```markdown
## Summary

- <primary bead title>
- <first sentence of the primary bead's description>

## Beads closed

- <primary-id> - <primary title>
- <additional-id> - <additional title>
  ...

## Test plan

- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:integration`
- [ ] `npm run build`
- [ ] Relevant e2e specs passing via build-guardian
```

**Single-bead PR:** pass only the primary id. The "Beads closed" section is a one-line list.

**Epic-closing or multi-bead PR:** pass every closed bead id. The primary id (first argument) still drives the Summary section; the other ids are looked up via `bd show --json` and rendered as `- <id> - <title>` entries.

The PR title is not rendered by this script. Use `commit-msg.sh` output as the PR title when there's exactly one bead, or hand-write one for multi-bead PRs (typically the epic's title without the `Epic:` prefix).

## When to push: after build-guardian, never before

A branch may not be pushed to `origin` until the wave's build-guardian agent has reported PASS. This rule exists because:

- Build-guardian is the last line of defence before CI sees the code. Pushing before it runs risks flipping a red CI badge on a PR that could have been fixed locally.
- Pushing triggers webhooks (deploy previews, bots) which assume the branch is at least locally-verified.
- An autonomous orchestrator pushing broken code wastes real-world cycles on retries.

**Concrete sequence for a wave:**

1. Implementers land commits on the branch.
2. Per-bead auditors run (via `agent-discovery`'s `match-agents.sh auditor`).
3. Build-guardian runs once per wave across all committed changes.
4. Only if build-guardian reports PASS does the orchestrator `git push -u origin <branch>` and open the PR.

If build-guardian reports FAIL, do not push. Fix locally, re-run build-guardian, and push only once it passes.

## `git-safe-to-start.sh`: phase-6 gate

When the orchestrator reaches the branch-creation step, the working tree should still be clean and still on `main` — but the full preflight (`bead-backlog-selection/preflight.sh`) ran in Phase 0, which may have been many phases ago. `git-safe-to-start.sh` is the narrow re-check: clean tree + on main, nothing else. It is intentionally cheaper than a full preflight.

Exit codes:

| Exit | Meaning |
|------|---------|
| 0    | Safe to branch: clean tree, on main |
| 1    | Not safe: wrong branch or dirty tree |
| 2    | Git itself failed (not inside a work tree, `git` binary missing, etc.) |

The expected main-branch name is `main` by default but can be overridden with the `GIT_SAFE_MAIN_BRANCH` env var, which is useful for test rigs and for repositories that use a non-`main` trunk.

## Testing

Fixture-driven bash tests live in `test/` and run with `./test/run-tests.sh`. The tests cover:

- Branch naming for each bead type, including epic, weird titles with apostrophes and slashes, and titles long enough to exercise the 60-char truncation.
- Commit message generation with and without scope, including multi-line summary flattening.
- PR body rendering for both single-bead and multi-bead (epic-closing) cases, with the primary bead's title and description driving the Summary block.
- `git-safe-to-start.sh` against real temporary git repos: clean+main, dirty+main, clean+wrong-branch, clean+custom-main, and non-repo directories.

Scripts are stubbed via the `BD_SHOW_CMD` environment variable, which the fixture runner points at a small shell script that `cat`s the appropriate JSON fixture. The real `bd` CLI is never called during tests.

All scripts are deterministic — the same input always produces the same output — and handle missing arguments by printing a usage message to stderr and exiting 2.

## Related skills

- `bead-backlog-selection` — owns the full preflight that this skill's `git-safe-to-start.sh` re-checks narrowly.
- `bead-wave-orchestration` — consumes these scripts when the orchestrator is about to set up a branch or open a PR.
- `epic-bead-workflow` — source of truth for how beads relate to branches and PRs.
