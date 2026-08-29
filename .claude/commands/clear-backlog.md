# Clear Backlog

Easy-win-first backlog sweep. Surveys open beads, triages them into tiers,
preflights the candidates to drop stale/blocked work, and ships the **Tier A
easy wins** autonomously — one branch/PR per bead — regardless of priority.
Reports what shipped and surfaces the beads that need a human decision.

Use it to drain the long tail of small, well-scoped chores quickly.

Tier B runs only with `--include-b` (or `--scheduled`, which implies it), and
**every Tier-B judgment is made by the advisor agent** — see "The Tier-B
advisor" below. The orchestrator never makes a Tier-B call itself.

Beads that are **not** small leaf chores (decision-spikes, features, large
rippling refactors, structured epics) are explicitly **excluded** here and left
for the `/plan` → `/analyze-bead` → `/spawn-bead-workers` pipeline or
human-in-loop work. Do not force them through this command.

## Arguments

- *(no args)* — default: survey → triage → preflight → **auto-run Tier A** →
  report. No confirmation gate; Tier B/C are not touched.
- `--confirm` — present the Tier A/B/C triage and ask which batch to run before
  dispatching anything (human-in-loop mode).
- `--triage-only` / `--dry-run` — produce the tiered triage report and stop.
  Zero changes.
- `--include-b` — after Tier A completes, also run Tier B (small + one
  decision). Implies the same per-bead dispatch flow, with the advisor gate:
  each Tier-B bead's decision is made by the advisor agent, the PR title
  carries a `[Tier B]` prefix, and at most **3 Tier-B PRs** ship per run.
- `--scheduled` — unattended weekly mode. Implies `--include-b`; asks no
  questions and never waits on a human (anything that would have been a
  confirmation or a "needs your decision" prompt goes into the report
  instead); runs the **queue gate** before dispatching anything and writes the
  per-run **report file** — see "Scheduled mode" below. Mutually exclusive
  with `--confirm`. The queue gate runs ONLY in this mode: a manual
  invocation (any other argument combination) never checks the queue.
- `--bead-ids <id>[,<id>...]` — skip selection/triage; run exactly these beads
  through preflight + dispatch. Use for a curated set you already chose.
- `--parallel` — dispatch up to **3** implementers concurrently (default:
  serial). Only safe when the targeted beads touch **disjoint files** — see the
  same-file overlap warning in Phase 3.
- `--analyze <id>` — route a single design-fork bead to the analysis subagent
  (Phase 4) instead of an implementer.

## Skill dependencies (source of truth — do NOT re-inline)

- [`git-workflow`](../skills/git-workflow/SKILL.md) — branch/commit/PR
  conventions. **No bead IDs** in any GitHub-facing artifact; conventional
  commits; no invented scopes. Every implementer loads this before committing.
- [`implementer-prompt-template`](../skills/implementer-prompt-template/SKILL.md)
  — the canonical implementer contract. **This command uses a documented
  *lightweight variant*** (see "The lightweight implementer" below): the
  refusal-on-unenriched protocol is intentionally bypassed because the triage +
  preflight steps replace formal enrichment for small leaf chores. Everything
  else (bead-first read, scoped edits, TDD, pre-close checklist, never run the
  full suite) is preserved.
- [`standards-routing`](../skills/standards-routing/SKILL.md) — each implementer
  discovers the relevant project standards skills for its change.
- [`bead-state-assessment`](../skills/bead-state-assessment/SKILL.md) /
  [`epic-bead-workflow`](../skills/epic-bead-workflow/SKILL.md) — the
  lifecycle-state and needs-human escalation concepts this command's preflight
  and needs-decision handling are built on. Escalate unworkable beads with
  `npx tsx .claude/tools/bead.ts escalate <id> "<reason>"`.

## Process

### PHASE 0: Preflight the environment

Run every `bd` command from the **workspace root** — `bd`'s database
resolution is cwd-dependent; `cd`-ing into a scratch/tmp dir makes it report
"no beads database found". Then:

```bash
git fetch origin
```

- `main` is often checked out in another worktree, so you may not be able to
  `git checkout main` here. That's fine — **every implementer branches off
  `origin/main`**, not local `main`.
- Run in a worktree that has `node_modules` (lint/tests need it). Do **not**
  give implementers isolated git worktrees — a fresh worktree lacks
  `node_modules` and breaks `npm run lint` / vitest.

### PHASE 1: Survey & tier

Pull the full open set (default JSON cap is 50 — use `--limit 0`) and build a
compact digest:

```bash
bd list --status=open --limit 0 --json --no-pager > /tmp/clear-backlog-open.json
```

Read each bead's title + description and sort into tiers. Judgment, not regex:

- **Tier A — true easy wins.** Settled design, ≤1–2 files, no real
  decision, low risk. Typical shapes: a type/annotation fix; a doc-comment
  addition; **additive** test coverage that mirrors an established pattern; a
  mechanical dedup with one clear target; a config-only change; a single-
  component sanitization/markup fix; consolidating split test files.
- **Tier B — small + one decision.** Contained refactor with a prescribed
  pattern but a real caller migration or one naming/scoping call: DDD interface
  extractions (make a property private; route a cross-domain import through an
  interface), helper extractions across 3–4 sites, deps-object constructor
  migrations, voluminous-but-mechanical stylesheet/token migrations.
- **Tier C — exclude.** Decision-spikes (titles/bodies that say *consider*,
  *decide*, *design*, *NOT ready to implement*), features, large/rippling
  refactors (anything that changes a **public API contract** or cross-cuts many
  domains), and structured multi-bead epics. These are **not** for this command.
- **Design-fork (special).** A bead with a genuine a-vs-b choice whose answer
  needs a consumer/impact audit. Not executed — routed to Phase 4.

Title heuristics lie. "Remove the X shim" can be an 8-call-site public-API
migration; "add Promise<T> typing" can be blocked on a missing dependency.
Tier from the body, and confirm in Phase 2.

### PHASE 2: Preflight the candidates (dud + design-fork detection)

**This is the step that earns its keep.** For every Tier A (and, if running,
Tier B) candidate, read the FULL bead — description **and** NOTES **and**
labels — and drop/flag duds before spending an implementer on them:

```bash
for id in <candidate-ids>; do
  echo "=== $id ==="
  bd show "$id" | grep -iE 'needs-human|SKIP|SKIPPED|BLOCK|blocked by|depends on|once pv-|requires pv-|stale|reverted|obsolete|superseded|deferred|not actionable|gitignored|local-only|do not'
done
```

Pull a candidate OUT of the executable batch if any of these hold:

1. It carries a `needs-human` label or a prior SKIP/blocked note.
2. Its premise references a production change, file, or symbol that is **not
   present in `origin/main`** (verify with a quick grep — backlog beads drift;
   the feature it tests/edits may have been reverted or never landed).
3. Its target is **not shippable via PR** (e.g. a gitignored / local-only file).
4. It has a genuine **design fork** where the right answer depends on a
   consumer/impact audit — route to Phase 4, do not guess.

If a preflight call is genuinely borderline — dud-vs-viable, or Tier B vs
Tier C — consult the Tier-B advisor rather than guessing. Misclassifying into
Tier C silently parks work, which the run's own report cannot surface.

Everything pulled goes into the **"needs your decision"** list for the final
report (with the reason). Do not silently skip — surface it.

### PHASE 3: Execute Tier A (default)

Dispatch one **lightweight implementer** subagent per surviving Tier A bead.

- **Default: serial**, one branch/PR per bead. Wait for each to finish, confirm
  it shipped (or handle its blocker), then dispatch the next.
- `--parallel`: up to **3** concurrent (HARD CAP). **Same-file overlap
  warning:** two beads that edit the same file produce branches that may
  conflict at merge time. Serial is safer; if parallelizing, group only
  disjoint-file beads in a batch and note any same-file pair so the user knows
  the merge order is non-trivial.

Render the lightweight-implementer prompt below for each bead, substituting the
bead id and a one-paragraph scope summary drawn from the bead.

After all Tier A beads resolve, if `--include-b` (or `--scheduled`) was
passed, repeat Phase 2 + Phase 3 for the Tier B set, with three additions:

1. **Advisor first.** Before dispatching a Tier-B implementer, send the bead's
   real decision (the naming/scoping call, caller-migration pattern, or
   interface shape) to the Tier-B advisor. The implementer receives the
   advisor's decision baked into its scope — it executes the choice, it does
   not re-open it.
2. **`[Tier B]` PR convention.** The PR title carries a `[Tier B]` prefix, and
   the PR description includes the advisor's rationale **verbatim** under a
   `## Decision made on your behalf` heading, so the reviewer can re-derive
   the call at merge time.
3. **Hard cap: 3 Tier-B PRs per run.** Tier-B beads beyond the cap are not
   dispatched; list them in the report as *deferred (Tier-B cap)* with their
   advisor verdicts if already obtained, so a future run or a human can pick
   them up.

### PHASE 4: Design-fork analysis path

For a design-fork bead (or `--analyze <id>`), dispatch an **analysis subagent**
(read-only + bead write; NO code change, NO branch, NO PR). It must:

1. Do the consumer/impact audit the bead asks for (trace producers and every
   consumer; determine whether the concern is a real, reproducible bug or only
   latent).
2. Recommend the resolution with rationale tied to `file:line` findings.
3. Write the analysis + recommendation to the bead: `bd update <id> --design
   "<findings + recommendation>"`. Leave the bead **OPEN** (not in_progress) —
   it awaits the human's go-ahead.
4. Report the producer/consumer map, the real-vs-latent verdict, and the
   recommendation.

If the human approves the recommendation and it turns out to be a small change
(e.g. "document it" → a doc-comment edit), it re-enters Phase 3 as a normal
Tier A implementer with the chosen option baked into its scope.

### PHASE 5: Report & surface decisions

Emit a final report (in `--scheduled` mode, written to the report file — see
"Scheduled mode" — instead of awaiting a human):

- **Shipped** table: `bead | PR # | one-line what`. Note each bead was closed.
- **Needs your decision** list: every dud/blocked/needs-human bead (with the
  reason) and every design-fork (with its written recommendation). For
  `needs-human`-class blockers, tag the bead so a future run skips it:
  `bd update <id> --labels needs-human` (and a `--notes` explaining why).
- **Tally**: open beads before → after; PRs opened (and how many already
  merged, if the user merged as you went).
- **Suggested next**: what's left and why it's not for this command.

## The Tier-B advisor

A dedicated subagent that makes every judgment call the orchestrator is not
allowed to make itself. Dispatch it on the **strongest available model**
(currently `claude-fable-5`); the orchestrator itself runs on an Opus-class
model — orchestration is procedural, the advisor moments are the only genuine
judgment in the sweep, and isolating them produces a discrete, auditable
decision artifact instead of an orchestrator grading its own homework.

Consulted at exactly two points:

1. **Each Tier-B bead's real decision** (Phase 3, `--include-b`): the
   naming/scoping call, caller-migration pattern, or interface shape the bead
   leaves open.
2. **Borderline Phase 2 preflight calls**: dud-vs-viable, or Tier B vs Tier C.

Contract:

- **Read-only plus bead-read.** No code changes, no branch, no PR, no bead
  writes. It reads the bead (`bd show <id>`) and the code on `origin/main`.
- Returns a **decision plus a compact rationale tied to `file:line`
  findings** — written to be pasted verbatim into a PR description, so it must
  stand alone for a reviewer who has not seen the bead.
- The orchestrator applies the decision (bakes it into the implementer's
  scope, or re-tiers the bead) and carries the rationale into the `[Tier B]`
  PR. It does not edit, soften, or summarize the advisor's rationale.

## Scheduled mode (`--scheduled`)

Unattended weekly run. Everything above applies, plus:

**Queue gate — before any dispatch.** Using `gh pr list`, count open non-draft
PRs that are passing CI and have no unresolved change request. If that count
is **6 or more**, or the **oldest** such PR is **older than 7 days**, stand
down: dispatch nothing and write a short report recording the gate reading.
The two values are fixed constants sized to the maintainer's review capacity —
they change only by a deliberate edit to this command, never inline by a
running agent. The gate exists so an unattended run cannot pile PRs onto an
already-full review queue; a human running this command by hand is making that
call themselves, which is why manual invocations skip the gate entirely.

**Per-run report.** Write `reports/clear-backlog/<YYYY-MM-DD>.md` in the
workspace (`reports/` is gitignored — verify, and add the pattern if
missing). Contents:

- the queue-gate reading (counts and verdict, even when the run proceeded)
- the **shipped** table: PR number and a one-line what
- every **Tier-B decision** with the advisor's rationale
- the **needs-decision** and **deferred (Tier-B cap)** lists, with reasons
- the before/after open-bead tally

The report is local and gitignored, so bead IDs are allowed there — they
remain forbidden in branches, commits, and PRs.

## The lightweight implementer (variant of `implementer-prompt-template`)

Dispatch a **general-purpose** subagent per bead. The prompt MUST include:

- **Read the bead first** (`bd show <id>`), including its NOTES/DESIGN. The bead
  is the source of truth; do not paste its body into the prompt — summarize the
  scope in one paragraph and let the agent read the live version.
- **Self-scope, don't refuse.** State explicitly: this is a small, low-decision
  leaf chore that has NOT been through the formal analyze/enrich pipeline — that
  is expected for this command — so do your own lightweight scoping and do NOT
  refuse for a missing "Implementation Context" block. Stay tightly scoped to
  what the bead describes.
- **Load skills before editing/committing**: `git-workflow` (NO bead IDs in
  branch/commit/PR; conventional commits; no invented scope) and
  `standards-routing` (find and follow the relevant project standards). Follow
  TDD where it applies.
- **Branch off `main`**: `git fetch origin`, then create the branch (name per
  `git-workflow` `branches.md`). This command's beads are independent leaf
  chores, not a dependency chain, so branching is the plain `git checkout -b`
  path in `git-workflow` `stacking.md` — no `gh stack` involved.
- **Pre-close checklist (in order), NEVER the full suite**:
  1. `pkill -f "vitest" 2>/dev/null || true`
  2. `npm run lint`
  3. Targeted tests only: `npx vitest run <files>` — **no `--maxThreads` flag**
     (unsupported in the repo's current vitest). For integration files, run the
     single file rather than the whole `test:integration` suite.
- **Ship it**: commit (conventional, no bead ID), push, and open the PR per
  `git-workflow` `pull-requests.md`/`stacking.md` (this command's beads are
  independent, so the single-branch path applies, not `gh stack`), then
  `gh pr edit <num> --title --body` (concise title/body, no bead ID), then
  `bd update <id> --notes "PR: <url>"` and `bd close <id>` — **only if lint +
  targeted tests passed.**
- **Refuse-and-report on blockers.** If the bead turns out NOT to be a small
  leaf chore (real ripples, ambiguous scope, premise doesn't match current
  code, a needed dependency is missing), STOP: do not close the bead, leave the
  tree recoverable, and report the blocker. Do not expand scope to make it work.
- **Report back**: PR URL, branch, files changed, lint/test results; for
  stylesheet/token beads, flag any intentional hue/contrast shift and any
  `@media`-only vs `[data-theme]` token-pattern drift, and recommend a visual QA
  pass in both themes before merge.

## Operational gotchas (verified)

- `bd` is cwd-sensitive — always run it from the workspace root.
- `bd list --status=open --json` caps at 50; use `--limit 0` for the full set.
- `bd show --json`'s `status` is not a simple field in all builds; grep the
  human output (`· OPEN` / `· CLOSED`) when scripting status checks.
- Branch every implementer off freshly-fetched `origin/main` (local `main` may
  be held by another worktree).
- Don't use per-agent isolated worktrees — they lack `node_modules`.
- `--maxThreads` is unsupported in the current vitest; use plain `npx vitest run`.
- Backlog beads drift: a non-trivial fraction have stale premises, `needs-human`
  flags, or unshippable targets. The Phase 2 preflight exists precisely to catch
  these before an implementer is spent on them.

## Acceptance / manual verification

This command has no automated tests. To sanity-check after an edit:

1. `/clear-backlog --triage-only` on the live backlog — confirm it produces the
   three tiers + a design-fork/dud list and makes **zero** changes.
2. `/clear-backlog --bead-ids <one-known-easy-win>` — confirm one branch/PR is
   produced off `origin/main`, the bead is closed with the PR noted, and the
   commit/branch/PR carry **no bead ID**.
3. Confirm a deliberately-stale or `needs-human` bead is pulled by Phase 2 into
   the "needs your decision" list rather than dispatched.
4. `/clear-backlog --include-b --triage-only` — confirm the triage names which
   Tier-B beads would go to the advisor and what each one's open decision is,
   with zero changes made.
5. For `--scheduled`: with 6+ qualifying PRs open (or a stale one), confirm the
   run stands down and writes a gate-reading report with zero dispatches; and
   confirm a normal run writes `reports/clear-backlog/<date>.md` and that the
   path is gitignored (`git check-ignore reports/clear-backlog/x.md`).
