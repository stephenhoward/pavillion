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

- **No draft PRs.** Open a PR only when ready for merge. When submitting through gt, this requires the `--publish` flag — see [stacking.md](stacking.md) for why. Stacked PRs are real PRs, individually ready for review; being upstack does not make a PR a draft.
- **No auto-merge.** The user reviews and merges manually.
- **Push to origin** only after build-guardian PASS (lint, unit, integration, build, e2e via build-guardian).
- **Squash merge** on landing.

## Pushing to origin

Pushing and PR creation go through the Graphite CLI: `gt submit` replaces `git push` + `gh pr create`. See [stacking.md](stacking.md) for the command patterns (submit flags, PR-shape follow-up via `gh pr edit`, and the merge/restack ritual).

Branch-name conformance still applies before the first submit: the branch gt pushes is the name GitHub readers see, so it must follow [branches.md](branches.md). If you are working in a worktree with an auto-generated local branch name (`apple-father`, `abrupt-grapple`), do not submit that branch — create a properly-named branch for the work per the worktree guidance in [stacking.md](stacking.md).

## Disallowed

- Bead IDs or other local tracker references in title or body.
- "Beads closed" sections, "Linked tickets" sections, or any other local-only reference list.
