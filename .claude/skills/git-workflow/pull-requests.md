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

- **No draft PRs.** Open a PR only when ready for merge.
- **No auto-merge.** The user reviews and merges manually.
- **Push to origin** only after build-guardian PASS (lint, unit, integration, build, e2e via build-guardian).
- **Squash merge** on landing.

## Disallowed

- Bead IDs or other local tracker references in title or body.
- "Beads closed" sections, "Linked tickets" sections, or any other local-only reference list.
