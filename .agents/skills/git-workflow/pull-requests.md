# Pull Requests

## Title

Mirrors the commit format:

```
<type>(<scope>): <summary>
```

For multi-commit branches, write a title that summarizes the branch as a whole rather than copying any single commit.

## Body template

Three sections, all required:

```markdown
## Motivation

[why this work was needed; what problem it solves]

## Approach

[what was done; the strategy or design taken; non-obvious decisions]

## Validation

[how this was tested; what was verified; relevant test runs]
```

No conditional sections (Screenshots, Migration notes, Deployment notes). Anything contextual goes inline in Approach or Validation.

## Issue references

`Closes #N` or `Fixes #N` appears in **both**:

1. The PR body — so GitHub auto-closes the issue on merge.
2. The commit footer — so the audit trail survives the squash merge.

In the PR body, place the reference wherever it reads naturally — top of Motivation as opening context, or as a final footer line.

## Workflow

- **No draft PRs.** Open a PR only when ready for merge. Singles satisfy this by never passing `--draft` to `gh pr create`. Chains satisfy it per [stacking.md](stacking.md) (`gh stack submit` needs an explicit flag to avoid its draft default). Stacked PRs are real PRs, individually ready for review; being upstack does not make a PR a draft.
- **No auto-merge.** The user reviews and merges manually.
- **Push to origin** only after build-guardian PASS (lint, unit, integration, build, e2e via build-guardian).
- **Squash merge** on landing.

## Pushing to origin

**Singles** (no stack involved) push and open PRs the plain way: `git push` + `gh pr create`. **Chains** (per [stacking.md](stacking.md)) go through `gh stack submit` instead — see [stacking.md](stacking.md) for the command patterns (submit flags, PR-shape follow-up via `gh pr edit`, and the merge ritual). No doc in this skill asserts that every push goes through `gh stack`; only stack levels do.

Branch-name conformance applies before the first push either way: the branch that gets pushed — by `git push` or by `gh stack submit` — is the name GitHub readers see, so it must follow [branches.md](branches.md). If you are working in a worktree with an auto-generated local branch name (`apple-father`, `abrupt-grapple`), do not push that branch — create a properly-named branch for the work per the worktree guidance in [stacking.md](stacking.md).

## Disallowed

- Bead IDs or other local tracker references in title or body.
- "Beads closed" sections, "Linked tickets" sections, or any other local-only reference list.
