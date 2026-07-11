# Branch Naming

## Pattern

```
<type>.<kebab-title>
```

Examples:

- `feat.widget-powered-by-footer`
- `fix.widget-config-accent-light-mode`
- `refactor.client-shadow-focus-brand`

## Allowed types

The full conventional-commit set:

- `feat` — new functionality
- `fix` — bug fix
- `chore` — housekeeping, tooling
- `refactor` — code restructure with no behavior change
- `docs` — documentation only
- `test` — test changes only
- `perf` — performance improvement
- `ci` — CI configuration
- `build` — build system or external dependencies
- `style` — formatting, whitespace

## Casing and characters

- Lowercase only.
- Alphanumerics, hyphens, and a single dot. The only dot is the one separating the type prefix from the title. No slashes anywhere.
- Words within the title separated by single hyphens. No underscores.

## Length

Total branch name ≤ 60 characters. If the kebab-title alone would push the branch over 60 chars, truncate the title segment at a word boundary; the type prefix is always preserved.

## Branch base

Branch from `main`, or from the parent branch when stacking per [stacking.md](stacking.md). Stacking is pre-authorized — it needs no per-branch prompt. For any other non-stack, non-main base, prompt the user before branching.

## Local vs. remote branch names

The convention above applies to the **remote (`origin`) branch name** — the name GitHub readers see in the branch list, PR list, and merge-commit messages. Local branch names do not have to match.

Some tooling (e.g. `superset.sh`) creates worktrees with auto-generated nonsense local branch names like `apple-father` or `abrupt-grapple`. Leave those local names alone, and never submit them: pushing goes through gt, which pushes the branch under its local name. Create a properly-named branch for the work instead — see the worktree guidance in [stacking.md](stacking.md).

## Disallowed

- Bead IDs or other local tracker IDs in the **remote** name.
- Suffix-style ID encoding (no `<title>-<id>`, no trailing identifiers).
- Mixed case in the remote name.
- Underscores in the remote name.
- Slashes anywhere in the remote name. The type and title are joined with a single dot, not a slash.
- Pushing a nonsense auto-generated branch name (from `superset.sh` or similar) straight to `origin` without renaming on push.
