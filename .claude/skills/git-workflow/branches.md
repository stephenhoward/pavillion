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

## Disallowed

- Bead IDs or other local tracker IDs.
- Suffix-style ID encoding (no `<title>-<id>`, no trailing identifiers).
- Mixed case.
- Underscores.
