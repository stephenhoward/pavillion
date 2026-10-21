---
description: Admit, judge and migrate Renovate major-version bumps from the Dependency Dashboard, then report what needs the maintainer
argument-hint: "[--scheduled] [--dry-run] | --admit <approve-branch key> | --migrate <pr>"
disable-model-invocation: true
---

# /upgrade-dependencies

Arguments: $ARGUMENTS

You are working the major version bumps on the Renovate Dependency Dashboard
(issue #561). Each run you admit a few majors, let CI judge them, migrate the
ones whose Renovate bump alone fails CI when the fix is a translation of
existing code, and write a report. The maintainer merges; you never merge.

Your scope is major bumps only. Minor and patch updates, and PRs labelled
`security`, belong to the maintainer — the helper already leaves them out.

## 1. Parse the arguments

| Arguments | Mode |
|---|---|
| *(none)* | Attended run: phases 0, 2, 3, 4. |
| `--scheduled` | Unattended run: phases 0–4 with the queue gate and time budget. Ask no questions; anything you would ask goes into the report. |
| `--dry-run` | Phases 0 and 4, read-only. |
| `--scheduled --dry-run` | As `--dry-run`, plus the queue-gate reading. |
| `--admit <key>` | Attended run that ticks exactly `<key>` in phase 2 instead of the queue. |
| `--migrate <pr>` | The maintainer's intervention path only — see "The `--migrate` path". |

Any other combination, or an unknown flag: stop and print this table.

**Read-only** means you write only under `reports/`, and change nothing on
GitHub (no tick, re-run, label, comment, push or workflow dispatch) or in
tracked files. In a read-only run, each later phase's report section says
what that phase would have done.

## 2. Start

```bash
mkdir -p reports/dependency-upgrades/run
date +%s > reports/dependency-upgrades/run/start
git fetch origin
```

Keep every intermediate file in `reports/dependency-upgrades/run/`
(gitignored), so the run can be picked up after a context compaction. Minutes
elapsed: `echo $(( ($(date +%s) - $(cat reports/dependency-upgrades/run/start)) / 60 ))`.

For `--migrate`, go to "The `--migrate` path" now.

## Constants

Change these only by editing this file.

| Constant | Value |
|---|---|
| Admissions per run | 3 |
| Migrations per run | 3 |
| CI re-runs per head commit | 1 |
| Time budget (`--scheduled`) | 90 minutes |

The queue gate's thresholds belong to `/clear-backlog` (see its "Scheduled
mode") and move with it.

The helper is `npx tsx .agents/tools/upgrade-dependencies.ts <subcommand>`, run from
the repo root; `.agents/tools/README.md` documents its output fields.

## Phase 0: Settle

```bash
npx tsx .agents/tools/upgrade-dependencies.ts dashboard > reports/dependency-upgrades/run/dashboard.json
npx tsx .agents/tools/upgrade-dependencies.ts prs > reports/dependency-upgrades/run/prs.json
```

Act on each PR in `prs.json` by its `kind`:

| `kind` | Action | Report section |
|---|---|---|
| `in-hand` | None. A commit that is neither Renovate's nor yours means the maintainer is working the branch. | Pending — in hand |
| `ready` | None. | Ready for review (`migrated` says whether a migration made it green) |
| `pending` | None. | Pending — CI running |
| `rerun` | `gh run rerun <id> --failed` for each of `rerunRunIds`. | Pending — re-runs issued |
| `gate-2` | Phase 3 candidate. | Per phase 3 outcome |
| `migration-failed` | Escalate with the failing checks; your one attempt is spent. | Needs your decision |
| `escalated` | None; an earlier run escalated it. | Needs your decision (carried over) |

A re-run's result is judged by the next run's phase 0: `prs` reads each
failing workflow run's attempt number from GitHub, so a flaky e2e or
federation job never costs an advisor pass.

From `dashboard.json`, list `awaitingRenovate` under *Pending — awaiting
Renovate* and `alreadyApplied` under *Pending — already applied*.

## Phase 1: Queue gate (`--scheduled` only)

Run `/clear-backlog`'s gate: count open non-draft PRs that pass CI and have no
unresolved change request (`gh pr list --json isDraft,reviewDecision,statusCheckRollup,createdAt`).
At 10 or more, or with the oldest older than 7 days, go straight to phase 4
and report the reading. The gate exists so an unattended run never adds to a
full review queue.

## Phase 2: Admit

Go to phase 3 instead when any of these holds:

- the run is read-only (report the first three `queue` entries as what would
  be ticked);
- `--scheduled` and 90 minutes have passed;
- `prs.json` has any `gate-2` or `rerun` PR, and the run is not `--admit`.
  Finishing red work comes before starting new work, and a PR re-run this run
  is likely to be `gate-2` next run. Report "admission skipped: red PRs
  outstanding".

Otherwise:

1. Take the first three entries of `queue` from `dashboard.json` — or, for
   `--admit`, the given key (confirm it is a candidate; if it has `waitsFor`
   or is another entry's peer, tick it anyway and say so in the report). The
   queue is already ordered (tooling first, then narrow runtime, then broad
   runtime; oldest release first) and already folds a coupled pair into its
   primary: tick only `key`, and record `peers`, which the migration bumps on
   the same branch.
2. Tick each: `npx tsx .agents/tools/upgrade-dependencies.ts tick <key>`.
3. Dispatch Renovate and wait for its run, in the background because it can
   take up to 15 minutes:
   `npx tsx .agents/tools/upgrade-dependencies.ts renovate 15` with
   `run_in_background: true`. Continue when it notifies you.
4. Re-run `prs` into `prs.json`. Report each admitted key with its new PR's
   classification (usually `pending`), or as *awaiting Renovate* if no PR
   opened. Do not wait for CI.

## Phase 3: Migrate

Skip when read-only (report the `gate-2` PRs that would go to the advisor).
Otherwise take the `gate-2` PRs, oldest `createdAt` first, at most three, one
at a time:

1. With `--scheduled`, stop once 90 minutes have passed; list the rest under
   *Not reached*.
2. **Ruling.** Dispatch the shape advisor (template below) and save its
   output to `reports/dependency-upgrades/run/ruling-<pr>.md`. A first line of
   `**Ruling: Redesign or behavior change.**` → escalate with the ruling and
   go to the next PR.
3. **Worktree.** `npx tsx .agents/tools/upgrade-dependencies.ts worktree <branch>`
   (Bash timeout 600000). It checks the branch out in
   `.agents/worktrees/upgrade-dependencies` and runs `npm ci` there, and prints `path`
   and `resetSha`.
4. **Migration.** Dispatch the migration implementer (template below).
5. On `Outcome: stopped` → escalate with the ruling followed by the
   implementer's finding. On `Outcome: pushed` →
   `npx tsx .agents/tools/upgrade-dependencies.ts annotate <pr> reports/dependency-upgrades/run/ruling-<pr>.md <files changed...>`,
   which appends `## Migration made on your behalf` below Renovate's body.
6. Move on without waiting for CI; the next run's phase 0 reads it.

## Phase 4: Report

Write `reports/dependency-upgrades/<YYYY-MM-DD>.md`, then copy it to
`reports/dependency-upgrades/latest.md` as the run's very last action — its
modification time is how a scheduler knows the run finished. Include every
section, writing "None." when empty:

- **Queue gate** — count, oldest PR's age and verdict; or "not run (manual
  invocation)".
- **Ready for review** — PR, package and span, and whether Renovate's bump
  alone was green or a migration made it so.
- **Admitted this run** — key, tier, peers, and the PR and its classification
  if it opened.
- **Migrated this run** — PR, package, ruling verbatim, files changed, lint
  and targeted-test results, "awaiting CI".
- **Needs your decision** — each escalation, new or carried over, with its
  reason verbatim and its recommendation.
- **Pending** — CI running; awaiting Renovate; already applied; in hand;
  re-runs issued (PR and run ids).
- **Not reached** — what the caps, the time budget or the admission skip left
  for a later run, and why.
- **Tally** — unticked Pending Approval checkboxes at start and at end (run
  `dashboard` again for the end figure); admitted; migrated; escalated; ready
  for review; minutes used.

The report stays local, so a bead ID may appear in it. Nothing pushed to
GitHub may carry one.

## Escalate

Escalating marks the PR so later runs leave it alone until the maintainer
acts:

```bash
gh label create needs-human --color d93f0b --description "Awaiting a maintainer decision" 2>/dev/null || true
gh pr edit <pr> --add-label needs-human
gh pr comment <pr> --body-file reports/dependency-upgrades/run/escalation-<pr>.md
```

The comment, and the report's *Needs your decision* entry, read:

```markdown
## Needs your decision

<the ruling, the ruling plus the implementer's finding, or the failing checks — verbatim>

Recommendation: <the advisor's Recommendation line; for a failed migration, "migrate attended — the translation was pushed and CI still fails <checks>">

Remove the `needs-human` label, push a commit of your own, or run `/upgrade-dependencies --migrate <pr>` to hand this back.
```

## The `--migrate` path

The maintainer is intervening, so the one-attempt, in-hand and escalated
rules do not apply.

1. Confirm `<pr>` is an open PR on a `renovate/*` branch
   (`gh pr view <pr> --json state,headRefName,title,statusCheckRollup`);
   otherwise stop and say why.
2. Dispatch the shape advisor. If CI is green, pass "none" as the failing
   checks.
3. Show the ruling verbatim and ask with AskUserQuestion: *Migrate now* or
   *Do not migrate*. Wait for the answer.
4. On *Do not migrate*, write the report with the ruling under *Needs your
   decision* and stop.
5. On *Migrate now*, run phase 3 steps 3–5 for this PR. If the ruling was a
   redesign, include the `<approval>` block in the implementer prompt. On a
   branch the maintainer has committed to, `resetSha` is their latest
   commit, which is the right reset point.
6. After a push, `gh pr edit <pr> --remove-label needs-human` (harmless if
   absent), then write the report with this PR under *Migrated this run*.

## Prompt templates

Fill each `{{PLACEHOLDER}}` and send the result as the subagent's prompt.

### Shape advisor

Dispatch a general-purpose subagent with `model: "fable"`, the strongest
available model: this ruling is the run's one real judgment.

```
<role>
You decide whether a failing Renovate major-version bump in this repository
can be fixed by translating existing code, or needs the maintainer. You read;
you change nothing — no checkout, install, edit, push or GitHub write.
</role>

<pr>#{{PR}} on branch {{BRANCH}}: {{TITLE}}</pr>
<failing_checks>{{FAILING_CHECK_NAMES_AND_RUN_IDS, or "none"}}</failing_checks>

Read:
1. The package's release notes and migration guide across the whole version
   span. Renovate's PR body (`gh pr view {{PR}} --json body`) carries the
   notes and links to the changelog.
2. Every use in the project: `git grep -n '<package>' origin/{{BRANCH}} -- src scripts`,
   plus any config file that names the package.
3. The failing logs: `gh run view <run-id> --log-failed`.

Rule with one of these:
- Translation: every edit re-expresses existing code in the library's new
  form — renamed or reshaped APIs, new import paths, a changed call
  sequence, a changed config format, a type the project must now name.
  Volume does not matter. Tests change only in how they call, never in what
  they assert.
- Redesign or behavior change: the library dropped, changed or now refuses
  behavior the project relies on, so a feature would work differently or
  stop working; or the migration means re-thinking how something is built;
  or a test would have to change what it asserts. Name the behavior or
  component.

Reply with exactly this, and nothing else. It is pasted into the PR as is, so
it must make sense to a reviewer who has not seen this prompt:

**Ruling: Translation.**  (or)  **Ruling: Redesign or behavior change.**

<rationale tied to file:line findings>

<for a translation: an "Edits" list — every change to make, including any
peer dependency to bump, with its version range>

Recommendation: <defer | pin | replace | migrate attended> — <one sentence>
(What the maintainer should do if this is escalated: defer when upstream is
likely to fix the problem or nothing presses; pin when the new major is
unusable for the project for now; replace when the library has moved away
from how the project uses it; migrate attended when the change is worth
making but needs a human's design.)
```

### Migration implementer

Dispatch a general-purpose subagent.

```
<role>
You migrate this repository to a new major version of a dependency, on
Renovate's branch, by carrying out a ruling another agent made. Execute the
ruling; do not re-open it.
</role>

<worktree>{{PATH}}</worktree>
<branch>{{BRANCH}}</branch>
<reset_sha>{{RESET_SHA}}</reset_sha>
<ruling>
{{RULING_VERBATIM}}
</ruling>
{{ONLY_FOR_AN_APPROVED_REDESIGN:
<approval>The maintainer accepted the behavior change this ruling names. Make
exactly that change, including any test assertions it names, and nothing
beyond it.</approval>}}

Work only inside {{PATH}}: it has this branch's lockfile installed. Run every
command there (`git -C {{PATH}} ...`, or with {{PATH}} as the working
directory). The checkout this session started in has a different lockfile,
so installing or testing there gives meaningless results and breaks it for
the next run.

1. Load the `git-workflow` and `standards-routing` skills.
2. Make the edits the ruling lists. Re-express existing code in the
   library's new form; tests change only in how they call. Bump any peer the
   ruling names with `npm install <peer>@<range>` (add `--save-dev` for a dev
   dependency) so the lockfile regenerates.
3. In {{PATH}}, run `npm run lint`, then `npx vitest run <files>` for every
   test file you touched and the tests of every source file you touched (add
   `--config vitest.integration.config.ts` for integration tests). Run
   nothing wider; CI runs the full suite. Leave any other vitest process
   alone: other sessions may own it.
4. When both pass, commit once with a conventional message (usually
   `build: migrate to <package> v<N>`), a body saying what changed and why,
   and `Migrated-by: upgrade-dependencies` as the last line and only trailer. Check
   with `git -C {{PATH}} log -1 --format=%B` and amend away any other
   trailer. Push with `git -C {{PATH}} push origin HEAD:{{BRANCH}}` — a plain
   push, never forced, because Renovate shares the branch. A rejected push
   means the branch moved: stop.

Stop rather than stretch the ruling when a change would alter behavior,
change what a test asserts, or need a redesign, or when lint or the targeted
tests cannot pass within the translation. To stop:
`git -C {{PATH}} reset --hard {{RESET_SHA}}` and `git -C {{PATH}} clean -fd`;
push nothing.

Reply in this shape:
Outcome: pushed | stopped
Commit: <sha or none>
Files changed: <one per line>
Lint: <pass or fail>
Tests: <command> — <passed/failed counts>
Finding: <stopped only — what blocked the translation, with file:line evidence>
```

## Acceptance checks (for whoever edits this command)

Helper tests: `npx vitest run --config .agents/tools/vitest.config.ts .agents/tools/test/upgrade-dependencies.test.ts`.

1. `--dry-run` on the live dashboard: a report with every section, and no
   change to GitHub or tracked files.
2. `--admit <tier-1 key>`: the dashboard diff is that one line, Renovate is
   dispatched, and the PR is reported as ready, pending, gate-2 or awaiting
   Renovate.
3. `--migrate <red renovate PR>`: the ruling is shown and nothing runs until
   answered; after a yes on a translation, the commit's only trailer is
   `Migrated-by: upgrade-dependencies` and the PR body ends with
   `## Migration made on your behalf`.
4. A renovate branch with a hand-made commit is listed as in hand and left
   untouched in every mode.
5. `--scheduled` with 10+ qualifying PRs (or one older than 7 days) writes a
   gate-reading report and ticks and migrates nothing.
