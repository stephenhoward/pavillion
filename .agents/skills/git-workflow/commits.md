# Commit Messages

## Header format

```
<type>(<scope>): <summary>
```

When no scope fits, omit the parenthetical entirely:

```
<type>: <summary>
```

## Allowed types

The full conventional-commit set: `feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`, `ci`, `build`, `style`. Same set as branch prefixes.

## Scope (optional)

Pick the scope that best reflects what the change touches.

**Backend domains** (under `src/server/`):

- `accounts`
- `calendar`
- `federation` (or a specific subsystem like `ap-inbox`)
- `media`
- `configuration`
- `public`
- and any other domain present in the codebase

**Frontend surfaces:**

- `client` — authenticated user app
- `site` — public calendar viewer
- `widget` — embeddable widget
- `admin` — instance admin pages

If nothing fits, omit the scope. Do not invent scopes to satisfy the format.

## Summary rules

- Imperative mood: "add" not "added", "fix" not "fixes".
- Lowercase first letter.
- No trailing period.
- Header total ≤ 72 characters.

## Body

Generally include a body unless the change is genuinely trivial (typo, single-line tweak). The body should describe broadly *where* the changes happened and *why*. Wrap lines around 72 characters.

## Footers

When applicable:

- `Closes #N` or `Fixes #N` — for GitHub issue auto-link. Also goes in the PR body (see [pull-requests.md](pull-requests.md)).
- `BREAKING CHANGE: <description>` — call out backward-incompatible changes.

## Never include

- Assistant trailers: `Co-authored-by: Claude`, `Generated-by: ...`, or any other AI-attribution line.
- Local tracker IDs: bead IDs, personal task IDs.
- Manually written `(#PR)` suffix — GitHub squash merge appends this automatically.

## Merge strategy

Squash merge is the default. Each PR collapses to one commit on `main`. The last commit message before merge becomes the historical record on `main`, with `(#PR)` auto-appended by GitHub.

## Examples

A feature commit with body and issue footer:

```
feat(calendar): add cancel-occurrence flow for recurring events

Calendar owners can now cancel a single occurrence of a recurring event
without affecting the rest of the series. Cancellation writes a one-off
override row that is consulted when expanding the series, and the public
site and widget rendering paths skip the cancelled instance.

Closes #198
```

A trivial fix with no body:

```
fix(widget): preserve focus on overlay close
```

A breaking-change commit:

```
refactor(federation): rename Actor.preferredUsername to Actor.handle

Aligns the field name with the rest of the codebase and the spec
glossary. Affects all federation entity serializers and the inbound
activity parsers.

BREAKING CHANGE: federation actors now expose `handle` instead of
`preferredUsername`. Downstream consumers reading from the actor JSON
must update their key reference.
```
