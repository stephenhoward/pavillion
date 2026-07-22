# Stacked Branches (gh-stack)

Stack operations go through GitHub's native stacking extension, `gh stack`
(private preview, pinned at **gh-stack 0.0.8** as of the 2026-07-21 spike).
Singles — independent, unstacked work — **never touch `gh stack`**: they use
plain `git checkout -b` / `git push` + `gh pr create`, exactly as before any
stacking tool existed. `gh` itself (not `gh stack`) remains the tool for PR
body edits, merging, and CI queries in both cases.

This file is the **sole source of truth** for `gh stack` command patterns and
stacking rules. Other skills (`bead-branch-and-pr`, `bead-backlog-selection`,
`bead-wave-orchestration`, etc.) cross-reference this file; they do not
restate its contents. The corresponding operations for orchestrators are
implemented only in `.claude/orchestrators/lib/helpers.ts` (`stackCreate`,
`stackSubmit`, `syncAndRestack`).

## When a stack exists

A stack exists when:

- **Dependency-driven:** a bd dependency chain among sibling beads — a chain
  of **2 or more** beads linked by bd dependency edges, each bead's branch
  building on its predecessor's.
- **Size-driven:** an oversized single piece of work split at working
  checkpoints into reviewable levels.

Independent pieces of work are **not** a stack: a lone bead, or a bead with no
chain, stays a plain branch off `main`, created and pushed with ordinary
`git`/`gh` — it never runs any `gh stack` command.

## gh-stack command patterns

| Old | New |
|---|---|
| `git checkout -b <name>` (chain head) | `gh stack init <name>` |
| `git checkout -b <name>` (next chain level) | `gh stack add <name>`, run from the chain's current top |
| `git push` + `gh pr create` | `gh stack submit --auto --open` |
| post-merge cleanup + rebase | `gh stack sync --prune` |

Rules:

- **Branch names are always passed explicitly** — never generated via `-m`
  auto-naming, never left to a tool default. Naming rules are unchanged:
  `<type>.<kebab-title>`, ≤60 chars, per [branches.md](branches.md).
- `gh stack init <name>` starts a stack — the first branch of a chain, off
  trunk. Bare `gh stack init <name>` defaults its base to `main`; the
  orchestrator instead passes an explicit `--base <trunk>` (`gh stack init
  --base <trunk> <name>`) so a non-default `GIT_SAFE_MAIN_BRANCH` is honored,
  matching `gitSafeToStart`. The human command form (bare `<name>`) and the
  orchestrator form (`--base <trunk> <name>`) are otherwise equivalent.
  Existing branches passed to `init` are adopted **automatically**; there is
  no `--adopt` flag in gh-stack 0.0.8 (it is deprecated/removed — invoking it
  warns and then fails for missing branch args). Plain
  `gh stack init <b1> <b2> <b3>` adopts a set of existing branches into a
  stack in one command.
- `gh stack add <name>` layers the next level onto the **current stack top**
  and must be run from a checkout sitting on that top branch. `add` has
  **no `--base` flag** — unlike `init` and `link`, which do take one — its
  base is implicit from whatever is currently checked out. There is no way to
  target a branch that isn't the checked-out top; if a chain was interrupted
  and resumed, re-checkout the top first.
- `gh stack submit --auto --open` pushes the chain's branches and
  creates/updates their PRs. `--auto` skips the interactive editor;
  **`--auto` creates drafts by default** — `--open` is required to satisfy the
  standing no-draft-PRs rule (see [pull-requests.md](pull-requests.md)).
  `--open`'s behavior on a re-submit (PRs that already exist) was not
  exercised by the spike — only PR *creation* was. As a safe interim (decision
  memo D3), every `submit` currently runs an unconditional `gh pr ready
  <number>` sweep over the stack's PR numbers afterward (`gh stack view
  --json`) — belt-and-suspenders while `--open`'s re-submit semantics are
  unproven. `gh pr ready` on an already-ready PR is a no-op, so the sweep
  cannot violate the no-draft invariant, only backstop it. This converges to
  reserve-only (sweep only if a PR surfaces as draft despite `--open`) once
  `--open` is proven reliable on re-submits — see the docstring on
  `stackSubmit` in `helpers.ts` for the exact trim condition. `submit` is
  confirmed idempotent on re-submit (no new commits, or new commits pushed)
  and never clobbers a title/body already set via `gh pr edit`.
- `gh stack view` / `gh stack view --json` / `gh stack view --short` inspect
  the current checkout's stack — local-only, they do not touch the network or
  prove repo enablement (see Preflight below).

## Independently-green invariant

**Every PR is independently green.** No stack level is submitted until it
passes validation at its own stack position. Consequence: split points are
working checkpoints — each level builds, lints, and passes its tests on its
own — not arbitrary diff slices. Broken builds never merge to `main`. This is
now reinforced server-side: GitHub runs CI on every stack PR, not just the
bottom one.

## PR shape

`gh stack submit` creates the PR; it does not know the project's PR template.
Immediately after submitting, set title and body with `gh pr edit` so the
Motivation/Approach/Validation template from
[pull-requests.md](pull-requests.md) stays canonical:

```bash
gh stack submit --auto --open
gh pr edit <num> --title "<type>(<scope>): <summary>" --body "$(cat pr-body.md)"
```

Stacked PR bodies carry **no "Stacked on #N" line** — GitHub's Stack Map UI
shows the hierarchy natively on every PR in the stack, so the body stays the
plain, unconditional Motivation/Approach/Validation template with no
stacking-specific section.

## Merge ritual

**Merging a stacked PR is web-UI-only — this is a hard platform constraint,
not a preference.** `gh pr merge --squash` (even with `--admin`) and the
direct REST merge endpoint both reject stacked PRs and say to use the GitHub
web interface; there is no `gh stack merge` subcommand. No CLI or API path
exists to merge a stacked PR in gh-stack 0.0.8. Merging happens by clicking
**Merge** on a PR in GitHub's Stack Map UI.

**Read this warning before merging anything mid-stack:** clicking Merge on a
PR merges that PR **and every unmerged PR below it, atomically, in one
operation.** There is no way to merge only PR N without also landing
everything under it.

- **Bottom-up (default):** click Merge on the **bottom** PR. Only that PR (and
  nothing below it, since nothing is below the bottom) lands. Repeat on the
  new bottom PR as each level becomes ready.
- **Whole-green-stack:** once every level is green and reviewed, click Merge
  on the **top** PR to land the entire remaining stack in one atomic
  operation.

`VERIFY:` **The server-side cascade-retarget claim is unverified.** GitHub is
expected to cascade-rebase the remaining PRs after a bottom-up merge and
retarget the new lowest PR at trunk, re-triggering CI on each — but this spike
could not observe it (merging is web-UI-only and no authenticated browser
session was available to click Merge and watch the result). Until a human
clicks Merge once on a scratch stack and confirms the sibling PR retargets
cleanly, treat local build-guardian re-validation of the retargeted level
after every merge as the conservative default, rather than relying on GitHub
CI alone as the re-validator.

After merging (and once the cascade-retarget claim is confirmed, purely a
local catch-up step): `gh stack sync --prune` — fetches, reconciles the
stack against trunk, and prunes local branches for merged PRs. Run it when
resuming local work on a stack after one or more PRs merged. The `/restack`
command wraps this.

## Worktree mode: native gh-stack-in-worktrees (permanent decision)

**One rule: stack operations always run in the checkout that owns the
branch.** For a single-chain epic, that checkout is the main checkout — no
worktree overhead, as with any other work. For each concurrently-scheduled
chain, it is that chain's own dedicated git worktree.

This is settled, not provisional. gh-stack's stack-tracking state lives in a
**per-git-dir JSON file** — `.git/gh-stack` for the main checkout,
`.git/worktrees/<name>/gh-stack` for each linked worktree, plus a `.lock` —
**not** in shared refs or shared config (branch refs themselves are shared
across worktrees as usual; stack tracking is not). Concretely: **a stack
tracked in one worktree is invisible from any other checkout**, including the
main checkout, until it is submitted (after which `gh stack checkout
<pr-number>` can pull it down anywhere). Running `gh stack init`, `add`,
`view`, or `submit` from inside the worktree that holds the chain's branches
works exactly like the main checkout — same commands, same behavior, fully
isolated by construction. This isolation is what makes it safe for up to 3
concurrent chains to run without cross-chain interference.

**Do not attempt the "adopt from the main checkout" pattern as a matter of
course.** It is a documented last-resort recovery path only, not a supported
mode: the worktree holding the branch must be fully removed first (`git`
itself refuses to check out a branch that is live in another worktree), and
the main checkout must not already be sitting on a branch that belongs to a
different local stack (`gh stack init` hard-errors on that). A failed
`gh stack init` in this sequence has been observed to partially write local
tracking state before the checkout step fails — recoverable, but not a clean
single command. Reach for it only when a worktree is gone and its stack needs
picking back up from the main checkout, never as the default branch-creation
path.

## Preflight requirement

Two tiers, both enforced before autonomous work begins:

1. **Cheap local hard-gates, every run:** `gh stack --version` (extension
   installed) and `gh auth status` (authenticated, `repo` scope). Either
   failing is a hard stop — there is no silent fallback to plain git for
   chain work.
2. **Repo feature enablement:** no read-only remote probe reliably surfaces
   whether the private preview is enabled for this repo (`gh stack view` is
   local-only; every remote-touching candidate is either mutating or requires
   a stack that doesn't exist yet). Enablement is instead treated as
   confirmed at cutover and re-verified by fail-safe runtime detection: the
   first real `gh stack submit` of a run surfaces **exit code 9** if access
   was ever silently revoked, and that is a hard stop — a clean, pre-merge
   refusal, never a corrupted or partial state. See `bead-backlog-selection`
   for how this surfaces to the orchestrator.

## Preview status

`gh stack` is a private-preview GitHub extension, repo-gated and
waitlist-gated; behavior may change under us. Pinned version for everything
in this document: **gh-stack 0.0.8**. If a future version changes flags or
semantics, re-verify against this file before relying on it, and update the
pinned version note above.
