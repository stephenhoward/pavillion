# Releases

## Format

```markdown
## Features

- **<area or feature name>** — <description>

## Fixes & Updates

- **<area or feature name>** — <description>
```

Release notes describe what shipped from the perspective of users, calendar owners, and instance operators. They do not cite PR numbers, commit SHAs, or any other implementation detail — those can be derived later with tooling if needed and should not clutter the user-facing summary.

## Section semantics

**Features**

Only end-user-visible new capabilities. Audience: calendar owners, instance operators, public site viewers, event attendees. Things they can see and use that they could not before.

**Fixes & Updates**

Everything else user-relevant: bug fixes, behind-the-scenes correctness changes (federation signing, serialization), refactors with user-visible impact (modal consolidation), i18n cleanup, infrastructure and deployment changes that operators feel.

**Drop entirely**

Orchestrator and agent infrastructure, advisor and auditor wiring, internal-only tooling and test additions — anything that does not affect what an end user, calendar owner, or instance operator sees or operates.

## Bullet shape

- Group by feature or area. When a single feature shipped across multiple PRs, it remains one bullet describing the feature — implementation slicing is invisible in release notes.
- One-liner for small focused changes; multi-sentence (~3 sentences with *what* + *why* + *what is affected*) for bigger chunks of work.
- No PR numbers, commit SHAs, bead IDs, or other implementation references.

## Tagging

- Tag format: `vX.Y.Z` (semver).
- Tag `main` at the merge commit; no release branches.
- Every release is final unless the user explicitly says otherwise (no RC, beta, or pre-release pattern by default).
- The user decides version bumps and 1.0 timing — this skill does not prescribe semver rules. The agent may suggest a bump, but the call is the user's.

## Cut-a-release procedure

The agent drafts; the user approves.

1. **Identify the last released tag.**

   ```bash
   gh release list --limit 1
   # or
   git describe --tags --abbrev=0
   ```

2. **Survey merged PRs since that tag.** Combine sources for best context:

   ```bash
   gh pr list --state merged --base main --search "merged:>=<last-tag-date>"
   git log <last-tag>..main --oneline
   ```

   Open PRs visually when a title alone does not carry intent — read the PR body for the *why*.

3. **Classify each PR** into Features, Fixes & Updates, or Drop using the section semantics above.

4. **Group multi-PR work** into single bullets by feature or area. The same feature spread across two or three PRs becomes one bullet describing the feature — the PR slicing is not surfaced in the notes.

5. **Draft the release notes** in the markdown structure above.

6. **Present the draft to the user** with a proposed (or "your call") semver bump.

7. **On approval, publish:**

   ```bash
   gh release create vX.Y.Z --notes-file <draft.md>
   ```

   This tags `main` at HEAD.
