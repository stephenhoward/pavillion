# Process Backlog

Autonomous backlog orchestrator. Picks the top-priority ready bead, drives it
from whatever state it's in through shape → (decompose) → analyze → implement →
verify → PR, and exits. One-shot per invocation — wrap in `/loop` for
continuous processing.

## Critical Invariant: Main Agent Orchestrates, Does Not Work

**The main agent's only responsibilities are:**

1. Running deterministic scripts (tool calls that emit JSON or exit codes).
2. Reading that JSON / those exit codes.
3. Routing to the next phase or exit based on the verdicts.
4. Summarizing the run at the end.

**Every LLM-judgment task is delegated to a subagent** via the Task tool. The
main agent never shapes a bead, analyzes a bead, decomposes a bead, writes
code, runs tests, composes commit messages, or writes a PR body. Each of
those is a subagent spawn; the main agent only dispatches and reads the
report.

If you catch yourself tempted to do any of the above "just this once,"
stop. Spawn the subagent.

## Arguments

- `--dry-run` — run Phases 0–2 only, emit a plan report, make zero changes.

No other arguments. The command always picks the next bead itself — no
explicit bead id.

## Prerequisites

- On branch `main`, clean working tree, `main` in sync with `origin/main`.
- At least one READY bead in the backlog that is not labelled `needs-human`.
- The six shared skills are present:
  - `.claude/skills/bead-state-assessment/`
  - `.claude/skills/bead-backlog-selection/`
  - `.claude/skills/bead-branch-and-pr/`
  - `.claude/skills/agent-discovery/`
  - `.claude/skills/implementer-prompt-template/`
  - `.claude/skills/bead-wave-orchestration/`

Phase 0 verifies all of this programmatically; you don't need to check by hand.

## Process

### PHASE 0 — Preflight

**Main agent runs script.** Do not try to fix any failure; report and exit.

```bash
bash .claude/skills/bead-backlog-selection/preflight.sh
```

Parse the JSON output `{ok, failures: [{kind, reason}, ...]}`.

- `ok: true` → proceed to Phase 1.
- `ok: false` → print the failures to the user verbatim and **exit**. Do NOT
  auto-commit, auto-stash, auto-switch branches, auto-pull, or retry. Each
  `kind` maps to a specific user-visible message:

| `kind` | Message |
|---|---|
| `dirty_tree` | "Working tree is dirty — commit or stash before re-running /process-backlog." |
| `wrong_branch` | "Not on main — return to main (or finish your current branch's PR) before re-running /process-backlog." |
| `stale_main` | "Local main is out of sync with origin/main — `git pull` (or fix remote access) before re-running /process-backlog." |
| `empty_backlog` | "No ready beads available (or every ready bead is labelled `needs-human`) — shape or unlabel a bead before re-running /process-backlog." |

**Hard stop — Safeguard 1:** any Phase 0 failure exits immediately.

### PHASE 1 — Pick the Top Bead

**Main agent runs script.**

```bash
bash .claude/skills/bead-backlog-selection/bd-top-ready.sh --limit=5
```

Parse the bead JSON on stdout. Record `id`, `issue_type`, `priority`, and
`created_at` (age).

Handle exit codes:

- `0` → bead JSON on stdout. Proceed.
- `2` → usage error. **Exit (bug, not bead problem).** Safeguard 6.
- `3` → stderr carries "backlog exhausted for automation" (every READY bead
  is labelled `needs-human`). **Print to the user and exit cleanly.**
  Safeguard 2.

**Hard stop — Safeguard 2:** exit code 3 means nothing is automatable; the
user must unlabel a bead (`bd update <id> --remove-label needs-human`) to
re-queue it. See [Escalation semantics](#escalation-semantics) below.

### PHASE 2 — State Assessment

**Main agent runs script.**

```bash
bash .claude/skills/bead-state-assessment/bd-state.sh <bead-id>
```

Parse the JSON `{state, missing_phases[], reasons[]}`.

Record the state. It drives the Phase 3/4/5 routing:

- `state == unshaped` → Phase 3 (auto-shape).
- `state == shaped` → Phase 3.5 (advisor review), then Phase 4 (sizing
  check + decompose if needed).
- `state == decomposed` → Phase 5 (analyze leaves).
- `state == analyzed` → Phase 5.5 (advisor review for epics) or skip to
  Phase 6 (leaf, ready to branch).
- `state == executing` or `state == complete` → unexpected. **Exit**
  (Safeguard 6; this bead should not have appeared in `bd ready`).

### `--dry-run` early exit

If `--dry-run` was passed, stop here and emit the plan-only report:

1. Print the target bead: id, type, priority, age.
2. Print the state verdict and `missing_phases[]`.
3. List the advisors that **would** run in Phase 3.5 by piping the bead's
   `Files to Modify` (from notes if already analyzed, otherwise from
   design field) one per line into:

   ```bash
   printf '%s\n' <file1> <file2> ... | \
     bash .claude/skills/agent-discovery/match-agents.sh advisor
   ```

   If the bead has no file hints at all (truly unshaped), print
   "no files implied by bead; advisors cannot be pre-matched."
4. List the auditors that **would** match per file-path hints using the
   same matcher with the `auditor` suffix.
5. Exit. Zero side effects: no `bd update`, no `git` changes, no subagents
   spawned.

### PHASE 3 — Auto-Shape if Needed (delegated)

**Condition:** `state == unshaped`.

**Main agent delegates to subagent** via Task tool. The subagent is
one-shot and must either populate the bead or return `ESCALATE`.

**Subagent prompt skeleton:**

> # Auto-shape bead: {bead_id}
>
> Read the bead:
>
> ```bash
> bd show {bead_id}
> ```
>
> The description alone exists — there is no design, no acceptance criteria,
> no spec. Your job is to turn this raw idea into a shaped bead: populate
> DESCRIPTION (expanded), DESIGN, ACCEPTANCE CRITERIA, and NOTES, then add
> the `shaped` label.
>
> **Explore the codebase** as needed to understand the context: grep for
> related terms, read adjacent files, consult product docs
> (`agent-os/product/mission.md`, `agent-os/product/roadmap.md`), and look
> at similar recent work.
>
> **Follow the shaping contract** documented in
> `.claude/commands/shape-bead.md` Steps 2–8 (scope, references, standards,
> technical design, acceptance criteria). You are acting autonomously — do
> not use AskUserQuestion; make best-guess choices, note assumptions in the
> bead's notes under an `## Assumptions` heading.
>
> **Write each field with a separate `bd update` call**, then add the
> `shaped` label:
>
> ```bash
> bd update {bead_id} --description="..."
> bd update {bead_id} --design="..."
> bd update {bead_id} --acceptance="..."
> bd update {bead_id} --append-notes="..."
> bd update {bead_id} --add-label shaped
> ```
>
> **Escalation protocol:** if the original description gives you fewer than
> 50 characters of actionable signal (no verb, no object, no clear
> outcome — e.g. title "Fix it"), do NOT fabricate a design. Stop and
> return the exact string:
>
> ```
> ESCALATE: <one-sentence reason>
> ```
>
> When done (shaped or escalated), report:
> - If shaped: "SHAPED. Summary: <one line>." (the main agent will re-read
>   the bead).
> - If escalated: "ESCALATE: <reason>".

**Main agent routes on subagent report:**

- `SHAPED` → re-run `bd-state.sh <bead-id>`, verify state advanced, proceed
  to Phase 3.5.
- `ESCALATE: <reason>` → run:

  ```bash
  bash .claude/skills/bead-backlog-selection/bd-escalate.sh <bead-id> "<reason>" 3
  ```

  Print the escalation summary (bead labelled `needs-human`, Escalation
  section appended). **Exit cleanly.** Safeguard 3.
- Any other shape → **Exit (bug, not bead problem).** Safeguard 6.

### PHASE 3.5 — Advisory Review of the Shaped Bead (delegated, parallel)

Runs whenever the bead is now in `state >= shaped` and code has not been
written yet. Advisors review the **plan**, not code.

**Main agent runs matcher script.** Build the "changed file list" from the
bead's **Key Files** in the design field (or `Files to Modify` in notes if
already enriched). One path per line, piped to:

```bash
printf '%s\n' <file1> <file2> ... | \
  bash .claude/skills/agent-discovery/match-agents.sh advisor
```

Parse the JSON array `[{name, path, description, rationale}, ...]`.

- Empty array → no matched advisors. Print
  "No advisors matched the bead's implied file set; proceeding without
  planning review." and skip to Phase 4.
- Non-empty → proceed to parallel spawn.

**Main agent spawns all matched advisors in a single Task batch**
(parallel fan-out per the skill's parallel-spawn pattern). Each advisor
gets the same template, adapted by the advisor's focus area:

**Advisor prompt skeleton:**

> Review this bead's implementation plan for [advisor's focus area]. The
> design is fully formed but no code has been written yet.
>
> **Bead ID:** {bead_id}
> **Title:** {title}
> **Description:** {description field content — scope, user stories,
> success criteria}
> **Technical Design:** {design field content — approach, patterns, files,
> decisions}
> **Acceptance Criteria:** {acceptance field content}
> **Notes:** {notes field content — references, standards, visuals}
>
> Apply your normal review process against the bead's fields. Emit one of
> the `review-mode-advisor` verdicts:
>
> - APPROVE
> - APPROVE WITH CONDITIONS (list each condition)
> - REQUEST CHANGES (list each concern)
>
> See `.claude/skills/review-mode-advisor/SKILL.md` for the verdict
> protocol.

**Main agent aggregates verdicts and routes** per
`review-mode-advisor` (the protocol documented in `agent-discovery`'s
"Verdict interpretation" section):

- **All APPROVE** → record "Advisory review passed" in the run summary;
  proceed to Phase 4.
- **Any APPROVE WITH CONDITIONS** → spawn a **refinement subagent** (see
  prompt skeleton below); then re-run **only the advisors that raised
  conditions** once with the revised bead. If all resolve to APPROVE or
  APPROVE WITH CONDITIONS, proceed. If any still REQUEST CHANGES, treat
  it as REQUEST CHANGES (below).
- **Any REQUEST CHANGES (first round)** → spawn a refinement subagent;
  re-run all advisors that raised the concern once with the revised
  bead. If all now APPROVE or APPROVE WITH CONDITIONS, proceed. If any
  still REQUEST CHANGES after this single refinement, run:

  ```bash
  bash .claude/skills/bead-backlog-selection/bd-escalate.sh <bead-id> \
    "advisor REQUEST CHANGES after one refinement: <summary>" 3.5
  ```

  **Exit cleanly.** Safeguard 4.

**Refinement subagent prompt skeleton:**

> # Refine bead {bead_id} based on advisor feedback
>
> Advisors reviewed the shaped bead and returned the following verdicts:
>
> {structured list of verdict + conditions/concerns per advisor}
>
> Update the bead's DESIGN, ACCEPTANCE CRITERIA, and NOTES fields to
> address every listed condition and concern. Use separate
> `bd update --design=`, `--acceptance=`, and `--append-notes=` calls.
> Do NOT change the DESCRIPTION unless the concerns require it (the
> description defines *what* we're building; conditions usually
> refine *how*).
>
> Append an `## Advisory Refinement (<date>)` section to notes summarizing
> what was changed and why.
>
> When done, report "REFINED. Summary: <one line>."

### PHASE 4 — Decompose if Needed (delegated)

**Main agent runs sizing script.**

```bash
bash .claude/skills/bead-state-assessment/bd-sizing-check.sh <bead-id>
```

Parse the JSON `{needs_decomposition, reasons[]}`.

Routing:

- `needs_decomposition == false` **or** the bead is already an epic (has
  children) → skip to Phase 5.
- `needs_decomposition == true` **and** the bead is a leaf → delegate
  decomposition:

**Subagent prompt skeleton:**

> # Decompose bead: {bead_id}
>
> Read `.claude/commands/decompose-bead.md` and follow its full process
> for this bead. The sizing check recommends decomposition because:
>
> {list reasons from bd-sizing-check.sh verdict}
>
> **Autonomous mode:** make best-guess decisions about hierarchy
> structure; do not use AskUserQuestion. Flag genuinely ambiguous work
> areas in your report rather than stopping.
>
> When done, report:
> - New epic id (if the original bead was promoted).
> - Number of child beads created.
> - The hierarchy in ASCII form.

**After decomposition completes**, re-run `bd-state.sh` on the (possibly
promoted) epic id; proceed to Phase 5 to enrich the leaves.

### PHASE 5 — Analyze if Needed (delegated)

**Condition:** the bead is an epic (has children) and at least one leaf
child fails `bd-enrichment-check.sh`. Skip this phase if the bead is a
leaf with `state == shaped` (go to Phase 6 after Phase 3.5 → Phase 4
sizing check cleared it as a cohesive leaf).

**Main agent iterates leaf children, testing enrichment:**

```bash
for leaf in $(bd show <epic-id> | parse children); do
  bash .claude/skills/bead-state-assessment/bd-enrichment-check.sh "$leaf"
done
```

If every leaf is already enriched (exit 0), skip to Phase 5.5.

If any leaf is unenriched (exit 1), **delegate to an analyze subagent**:

**Subagent prompt skeleton:**

> # Analyze bead: {epic_id}
>
> Read `.claude/commands/analyze-bead.md` and follow its full process
> for this epic. Some leaf children lack Implementation Context in their
> notes:
>
> {list unenriched leaf ids}
>
> **Skip Phase 1.5** (decomposition assessment) — decomposition is already
> complete. **Start from Phase 2** (Map the Hierarchy) and continue through
> Phase 5 (Store Analysis in Bead Notes) for every unenriched leaf.
>
> **Autonomous mode:** proceed through all leaves without pausing. Flag
> any issues in your report rather than stopping to ask.
>
> When done, report the execution waves and confirm every leaf's notes
> contains an `Implementation Context` block.

**After analyze completes**, re-run `bd-enrichment-check.sh` on every leaf
as a belt-and-braces check. If any leaf is still unenriched, **exit (bug,
not bead problem).** Safeguard 6.

### PHASE 5.5 — Advisory Review of the Analyzed Plan (delegated, parallel)

**Condition:** epic only. Skip if the target is a single leaf.

Advisors review the enriched epic plan — specifically the leaves'
Implementation Context, aggregated file list, and the execution-wave
structure recorded in the epic's notes.

**Main agent runs matcher:** assemble the union of every leaf's
`Files to Modify` into one file list, pipe to
`match-agents.sh advisor`.

**Parallel spawn + verdict handling is identical to Phase 3.5**, with
one substitution: the advisor prompt's "Bead" section lists the epic id,
and the "Technical Design" section references the enriched leaves'
Implementation Context rather than the epic's design field alone.

**Main agent routes identically:** All APPROVE → proceed to Phase 6;
APPROVE WITH CONDITIONS → refine + re-run affected advisors; REQUEST
CHANGES → refine once, re-run, escalate if still REQUEST CHANGES:

```bash
bash .claude/skills/bead-backlog-selection/bd-escalate.sh <epic-id> \
  "advisor REQUEST CHANGES on analyzed plan after one refinement: <summary>" 5.5
```

**Exit cleanly.** Safeguard 4.

### PHASE 6 — Set up Branch (delegated)

**Main agent delegates to a git-setup subagent.** The subagent runs the
narrow safety re-check and creates the branch using the skill's
scripts. The main agent does not run `git checkout` itself — branch
creation is a write operation that belongs in a subagent.

**Subagent prompt skeleton:**

> # Create branch for bead: {bead_id}
>
> 1. Run the narrow safety re-check:
>
>    ```bash
>    bash .claude/skills/bead-branch-and-pr/git-safe-to-start.sh
>    ```
>
>    Exit code 0 → safe. Exit 1 → dirty tree or wrong branch; stop and
>    report "UNSAFE: git-safe-to-start exited 1 — <stderr line>". Exit 2
>    → git failure; stop and report "UNSAFE: git failure".
>
> 2. Derive the branch name:
>
>    ```bash
>    BRANCH=$(bash .claude/skills/bead-branch-and-pr/branch-name.sh {bead_id})
>    ```
>
> 3. Create the branch from main and check it out:
>
>    ```bash
>    git checkout -b "$BRANCH"
>    ```
>
> 4. Report: "BRANCH: $BRANCH" (or "UNSAFE: <reason>" if step 1 failed).

**Main agent routes on subagent report:**

- `BRANCH: <name>` → record the branch name; proceed to Phase 7.
- `UNSAFE: ...` → print the reason and **exit**. Preflight passed in
  Phase 0 but something regressed (user did work in parallel, a hook
  committed). Safeguard 1 re-applies.
- Any other shape → **Exit (bug, not bead problem).** Safeguard 6.

### PHASE 7 — Execute (delegated)

Routing by bead type (from Phase 2 state assessment and the current
bead's `issue_type` after any promotion in Phase 4):

- **Epic** (bead has children) → Branch A.
- **Leaf** (no children) → Branch B.

#### Branch A — Epic execution (delegated)

**Main agent delegates to a wave-orchestration subagent.** This subagent
plays the role that `/spawn-bead-workers` plays for humans — but runs
autonomously.

**Subagent prompt skeleton:**

> # Orchestrate epic: {epic_id}
>
> Read `.claude/skills/bead-wave-orchestration/SKILL.md` and
> `.claude/skills/implementer-prompt-template/SKILL.md`. Follow the wave
> lifecycle documented in `bead-wave-orchestration` exactly:
>
> - Max 3 implementers in parallel (hard cap).
> - Per-bead auditors matched via `.claude/skills/agent-discovery/match-agents.sh auditor` after each implementer closes.
> - Wave-end chain (sequential, not parallel):
>   1. `cross-bead-integration-verifier` if wave size > 1.
>   2. `architecture-auditor` (light pass).
>   3. **One** `build-guardian` per wave.
> - Cascade to the next wave after build-guardian PASS.
> - Epic-completion sweep (comprehensive reviewers + `implementation-verifier`) after the last wave.
>
> Every implementer you spawn must use the canonical prompt from
> `implementer-prompt-template` — do NOT paraphrase it.
>
> **Autonomous mode (no user prompts):**
> - Per-bead auditor FAIL → retry once; a second FAIL → escalate the
>   affected bead via
>   `.claude/skills/bead-backlog-selection/bd-escalate.sh <leaf-id> "<reason>" 7`
>   and stop orchestrating; report "ESCALATED: <leaf-id>".
> - Build-guardian FAIL → run `test-failure-investigator`, spawn a
>   follow-up implementer (counts as a retry), re-run build-guardian.
>   After 2 retries on the same bead, escalate and stop.
>
> **Report format on finish:**
> - `COMPLETE` — every bead in the epic closed, build-guardian PASS on
>   the last wave, comprehensive sweep clean. Include wave summary and
>   any PASS WITH WARNINGS notes.
> - `ESCALATED: <bead-id>` — could not recover; branch preserved. Include
>   which wave + which retry exhausted.
> - Any other shape is a bug.

**Main agent routes on subagent report:**

- `COMPLETE` → proceed to Phase 8.
- `ESCALATED: <bead-id>` → record the escalation (the wave subagent
  already called `bd-escalate.sh`); print summary and **exit cleanly
  with branch preserved.** Safeguard 5.
- Any other shape → **Exit (bug, not bead problem).** Safeguard 6.

#### Branch B — Leaf execution (delegated)

**Main agent delegates three successive subagents:** implementer →
matched auditors → single build-guardian.

##### Step B.1 — Implementer (delegated)

**Main agent spawns a single implementer subagent.** The prompt must be
the canonical template from `implementer-prompt-template/SKILL.md`,
verbatim, with `{bead_id}` substituted. Do NOT paraphrase or trim.

(Rendering the canonical template here inline: spawn one Task with
the prompt as defined in `.claude/skills/implementer-prompt-template/SKILL.md`
"The canonical prompt" section.)

**Main agent routes on subagent report:**

- Bead closed (verify via `bd show <bead-id>`; status should be CLOSED)
  → proceed to Step B.2.
- Implementer reported "Bead {bead_id} is not enriched." — Safeguard 6
  triggered, because state assessment in Phase 2 should have caught
  this. **Exit (bug, not bead problem).**
- Implementer reported a test failure or other blocker → record as
  "attempt 1 failed" and move to the retry protocol below.

##### Step B.2 — Per-bead auditors (delegated, parallel)

**Main agent runs the matcher** on the leaf's `Files to Modify` (or
`git diff --name-only main...HEAD` if a commit landed):

```bash
printf '%s\n' <file1> <file2> ... | \
  bash .claude/skills/agent-discovery/match-agents.sh auditor
```

Parse the JSON array. Empty array → no per-bead auditors apply; proceed
to Step B.3.

Non-empty → **spawn every matched auditor in a single Task batch**
(parallel fan-out). Auditor prompt:

> # Audit changes for bead: {bead_id}
>
> You are the {auditor-name} running in post-code mode. Review the
> changes landed on the current branch:
>
> ```bash
> git diff main...HEAD
> ```
>
> Apply your normal audit process. Emit one of the `review-mode-auditor`
> verdicts (PASS / PASS WITH WARNINGS / FAIL) per
> `.claude/skills/review-mode-auditor/SKILL.md`.

**Main agent aggregates per-auditor verdicts:**

- Any FAIL → treat as implementation failure; move to retry protocol
  below.
- All PASS or PASS WITH WARNINGS → record warnings for the PR body,
  proceed to Step B.3.

##### Step B.3 — Build-guardian (delegated, sequential)

**Main agent spawns exactly one `build-guardian`.** Never more than one
build-guardian at a time (test suites must not run concurrently).

> # Build verification for bead: {bead_id}
>
> Run the sequential build suite: lint → unit → integration → build →
> e2e (as applicable). Report PASS or FAIL with the failing subset.

**Main agent routes on report:**

- PASS → proceed to Phase 8.
- FAIL → move to retry protocol.

##### Retry protocol (Branch B)

**Max 1 retry for Branch B** — on failure (implementer blocker, auditor
FAIL, or build-guardian FAIL), spawn one follow-up implementer with
learnings from the failure, then re-run only the affected downstream
step(s):

- Implementer blocker fixed → re-run auditors (B.2) and build-guardian
  (B.3).
- Auditor FAIL fixed → re-run auditors (B.2) and build-guardian (B.3).
- Build-guardian FAIL fixed → re-run build-guardian (B.3) only.

If the retry itself fails (second attempt exhausts), run:

```bash
bash .claude/skills/bead-backlog-selection/bd-escalate.sh <bead-id> \
  "implementation retry exhausted: <summary>" 7
```

**Exit cleanly with the branch preserved.** The branch stays on disk so
the human can inspect the partial work. Safeguard 5.

### PHASE 8 — Finalize PR (delegated)

**Main agent delegates to a PR-finalization subagent.**

**Subagent prompt skeleton:**

> # Finalize PR for bead: {primary_bead_id} (branch: {branch_name})
>
> 1. Verify every target bead is closed:
>
>    ```bash
>    bd show <bead-id>
>    ```
>
>    For an epic run, that's the epic + every leaf child. For a leaf
>    run, just the one bead. If any target bead is still OPEN or
>    IN_PROGRESS, stop and report "UNCLOSED: <bead-id>".
>
> 2. Render the PR body:
>
>    ```bash
>    bash .claude/skills/bead-branch-and-pr/pr-body.sh {primary_id} [<additional-ids>...]
>    ```
>
>    Capture the stdout markdown.
>
> 3. Derive the PR title from the primary bead's title (strip the
>    `Epic:` prefix if present). Use `commit-msg.sh` formatting if
>    single-bead:
>
>    ```bash
>    bash .claude/skills/bead-branch-and-pr/commit-msg.sh {primary_id} "<short summary>"
>    ```
>
> 4. Push the branch:
>
>    ```bash
>    git push -u origin "{branch_name}"
>    ```
>
> 5. Create the PR:
>
>    ```bash
>    gh pr create --title "<title>" --body "<body>"
>    ```
>
>    Capture the PR URL from the output.
>
> 6. Report: "PR: <url>" on success; "UNCLOSED: <bead-id>" if step 1
>    failed; "ERROR: <message>" for any other failure.

**Main agent routes on subagent report:**

- `PR: <url>` → record the URL; proceed to Phase 9.
- `UNCLOSED: <bead-id>` → **Exit (bug, not bead problem).** Safeguard 6
  — Phase 7 should not have reported COMPLETE / Branch-B success with
  an unclosed bead.
- `ERROR: <message>` → **Exit (bug, not bead problem).** Safeguard 6.

### PHASE 9 — Report and Exit

**Main agent assembles the run summary** from the records collected
during Phases 1–8. No further subagents.

```
## /process-backlog run complete

**Target bead:** {bead_id} — {title} ({type}, priority P{priority})
**Branch:** {branch_name}
**PR:** {pr_url}

### Planning
- State at start: {state_at_start} (missing phases: {missing_phases})
- Auto-shape: {ran | not needed}
- Advisory review (Phase 3.5): {APPROVE count / APPROVE-WITH-CONDITIONS count / REQUEST-CHANGES count}
- Refinement rounds: {count}
- Decompose: {ran | not needed}
- Analyze: {ran | not needed}
- Advisory review (Phase 5.5): {verdict summary | skipped — leaf}

### Execution
- Branch type: {A — epic | B — leaf}
- Waves run: {count}
- Per-bead auditor warnings: {count}
- Build-guardian: PASS
- Retries triggered: {count}

### Warnings and notes
{bullet list of PASS-WITH-WARNINGS findings, surfaced for the PR reviewer}
```

Exit.

## Hard-stop Safeguards (reference)

1. **Preflight failure** — dirty tree, wrong branch, stale main, empty
   backlog → exit in Phase 0.
2. **Backlog exhausted for automation** — every ready bead labelled
   `needs-human` → exit in Phase 1 (exit code 3 from `bd-top-ready.sh`).
3. **Auto-shape escalates** → `bd-escalate.sh` and exit in Phase 3.
4. **Advisor REQUEST CHANGES after one refinement** → `bd-escalate.sh`
   and exit in Phase 3.5 or Phase 5.5.
5. **Retry exhaustion in Phase 7** → `bd-escalate.sh`, preserve branch,
   exit.
6. **Any subagent reports an unexpected state** → exit. This is a bug,
   not a bead problem; do NOT escalate the bead. The subagent contract
   is documented inline with its prompt skeleton; a report that doesn't
   match one of the documented shapes means the subagent misbehaved.

## Escalation Semantics

A bead that gets labelled `needs-human` is **skipped by every future
`/process-backlog` run** until a human removes the label. The
`bd-top-ready.sh` script filters out labelled beads; if every ready bead
is labelled, Phase 1 exits with "backlog exhausted for automation."

**To un-stick a labelled bead:**

1. Read the bead's notes, specifically the `## Escalation (<date>)`
   section appended by `bd-escalate.sh`. It records the phase that gave
   up and the reason.
2. Fix the underlying issue:
   - **Phase 3 escalation** (auto-shape ran out of signal) → reshape
     the bead manually via `/shape-bead <id>` or `bd update <id>
     --description="..."` with a fuller description.
   - **Phase 3.5 / 5.5 escalation** (advisors REQUEST CHANGES) → read
     the advisor feedback in the refinement's notes section; adjust
     the design / scope to address the concerns.
   - **Phase 7 escalation** (implementation retry exhausted) → read
     the branch that was preserved (it's still checked out or, if
     you've moved on, `git checkout <branch>`); diagnose the failure
     (test output, build output, auditor FAIL reasons), fix forward
     manually, or reshape the bead to a more tractable scope.
3. Remove the label:

   ```bash
   bd update <bead-id> --remove-label needs-human
   ```

4. The bead is now eligible for the next `/process-backlog` invocation.

Escalation is **durable but reversible**. The `## Escalation` section
stays in notes as a historical record even after the label is removed,
so future runs (and future humans) can see that the bead has a history.

## Acceptance Criteria

- [ ] `.claude/commands/process-backlog.md` exists and is invokable as
      `/process-backlog` and `/process-backlog --dry-run`.
- [ ] All 10 phases (0, 1, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 8, 9) are present
      and correctly ordered.
- [ ] `--dry-run` runs Phases 0–2 only with zero side effects (no
      `bd update`, no git changes, no subagent spawns).
- [ ] Every LLM-judgment task (auto-shape, advisory review, refinement,
      decompose, analyze, branch setup, execute, PR finalization) is
      delegated to a subagent; the main agent only runs scripts, reads
      JSON, and routes.
- [ ] All six hard-stop safeguards are explicit and distinguishable by
      their exit messages.
- [ ] References the six shared skills by path at the points they are
      invoked.
- [ ] Escalation semantics are documented inline.

### Manual Test Plan

No automated test harness exists for slash commands. Verify the command
by hand against these eight scenarios (from the design spec's
acceptance criteria 4–8):

1. **`--dry-run`** — Invoke `/process-backlog --dry-run` against a
   backlog containing at least one ready bead. Expect: target bead id,
   type, priority, age; state verdict + `missing_phases[]`; list of
   advisors that WOULD match; list of auditors that WOULD match. Run
   `git status` afterwards to confirm the working tree is untouched and
   `bd show <bead-id>` to confirm the bead is unchanged.

2. **Happy path (leaf)** — Seed a small shaped bead that touches one
   file, invoke `/process-backlog`. Expect: auto-shape skipped (bead is
   already shaped); advisors APPROVE; sizing check does not recommend
   decomposition; analyze enriches (or was already enriched); branch
   created; implementer closes the bead; per-bead auditors PASS;
   build-guardian PASS; PR opened. Verify the PR's body references the
   bead id and the bead is CLOSED.

3. **Phase 3.5 refinement** — Seed a shaped bead with a deliberate
   privacy concern (e.g. "log the user's email to console on every
   login"). Invoke `/process-backlog`. Expect:
   `privacy-advisor` returns REQUEST CHANGES, a refinement subagent
   updates the design/notes, privacy-advisor re-runs and resolves.
   Verify the bead's notes contains an `## Advisory Refinement
   (<date>)` section.

4. **Escalation skip-on-retry** — Create an unshapeable bead:
   `bd create --title="Fix it" --type=task --priority=2`.
   Invoke `/process-backlog`. Expect: Phase 3 auto-shape subagent
   returns ESCALATE; the bead gets the `needs-human` label and an
   `## Escalation (<date>)` section; the command exits cleanly.
   Invoke `/process-backlog` a second time: it should pick a
   different bead (the labelled one is filtered out by
   `bd-top-ready.sh`). Remove the label:
   `bd update <bead-id> --remove-label needs-human`, re-shape the
   bead manually; on the next invocation it is eligible again.

5. **Dirty tree safeguard** — With an uncommitted change in the
   working tree, invoke `/process-backlog`. Expect Phase 0 to exit
   with "Working tree is dirty — commit or stash before re-running
   /process-backlog." Verify no subagent was spawned and no bead
   state changed.

6. **Wrong branch safeguard** — Checkout any branch other than `main`
   and invoke `/process-backlog`. Expect Phase 0 to exit with "Not on
   main — return to main ... before re-running /process-backlog."

7. **Empty backlog safeguard** — With every ready bead labelled
   `needs-human` (or no ready beads at all), invoke `/process-backlog`.
   Expect Phase 1 to exit with "backlog exhausted for automation."

8. **Forced build-guardian failure** — Seed a shaped leaf bead whose
   implementation will break an existing unit test (e.g. rename a
   public export). Invoke `/process-backlog`. Expect: implementer
   closes the bead (targeted tests pass locally); per-bead auditors
   PASS; build-guardian FAILs; one retry via `test-failure-investigator`
   + follow-up implementer; if the retry also FAILs, `bd-escalate.sh`
   runs, the bead is labelled `needs-human`, and the command exits
   cleanly with the branch preserved (verify with `git branch` that
   the feature branch still exists).

## Design References

- Design spec: `docs/superpowers/specs/2026-04-16-process-backlog-workflow-design.md` (local, not committed).
- Parent epic: `pv-9cfj` (run `bd show pv-9cfj`).
- This command: bead `pv-9cfj.7`.
- Shared skills consumed (paths, all required to exist):
  - `.claude/skills/bead-state-assessment/SKILL.md`
  - `.claude/skills/bead-backlog-selection/SKILL.md`
  - `.claude/skills/bead-branch-and-pr/SKILL.md`
  - `.claude/skills/agent-discovery/SKILL.md`
  - `.claude/skills/implementer-prompt-template/SKILL.md`
  - `.claude/skills/bead-wave-orchestration/SKILL.md`
- Verdict protocol skills referenced from subagent prompts:
  - `.claude/skills/review-mode-advisor/SKILL.md`
  - `.claude/skills/review-mode-auditor/SKILL.md`
