# Branch Naming

## Pattern

```
<type>/<kebab-title>
```

Examples:

- `feat/widget-powered-by-footer`
- `fix/widget-config-accent-light-mode`
- `refactor/client-shadow-focus-brand`

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
- Alphanumerics and hyphens. The only slash is the one separating the type prefix from the title.
- Words separated by single hyphens. No underscores or dots.

## Length

Total branch name ≤ 60 characters. If the kebab-title alone would push the branch over 60 chars, truncate the title segment at a word boundary; the type prefix is always preserved.

## Branch base

Branch from `main` by default. If there is a reason to branch from somewhere else, prompt the user before branching.

## Local vs. remote branch names

The convention above applies to the **remote (`origin`) branch name** — the name GitHub readers see in the branch list, PR list, and merge-commit messages. Local branch names do not have to match.

Some tooling (e.g. `superset.sh`) creates worktrees with auto-generated nonsense local branch names like `apple-father` or `abrupt-grapple`. Leave those local names alone — but when pushing, push to a properly-named remote ref:

```bash
git push -u origin HEAD:feat/widget-powered-by-footer
```

This sets the upstream so subsequent `git push` calls go to the same remote name. Verify with `git branch -vv` after the first push: the local branch should show `[origin/feat/widget-powered-by-footer]` as its upstream.

If the local branch name already conforms (e.g. you created it manually with `git checkout -b feat/...`), `git push -u origin HEAD` is fine — no rename needed.

## Disallowed

- Bead IDs or other local tracker IDs in the **remote** name.
- Suffix-style ID encoding (no `<title>-<id>`, no trailing identifiers).
- Mixed case in the remote name.
- Underscores in the remote name.
- Pushing a nonsense auto-generated branch name (from `superset.sh` or similar) straight to `origin` without renaming on push.
