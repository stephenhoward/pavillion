# /tool-friction-retro — mine work sessions for tool friction, propose instruction fixes

Review recent work sessions for time lost to tool errors — compensating for them,
re-deriving what they mean, retrying around them — and propose small fixes to the
right skill, command file, or AGENTS.md that would save that time permanently.

**Investigate and propose only.** Proposals land as pull requests left unmerged for
the maintainer's review. This command never merges, never edits application code,
and never changes anything outside instruction/agent-config files.

## Flags

- *(no flags)* — attended run. Full method below; no queue gate; report printed to
  the conversation instead of (or in addition to) the report file.
- `--scheduled` — unattended monthly mode. Asks no questions (uncertainty goes to
  the report, not a prompt); runs the **queue gate** before opening any PR; writes
  the per-run **report file**. The gate runs ONLY in this mode: a human invoking
  the command by hand is making the queue call themselves.
- `--dry-run` — investigate and write/print the report, open no PRs.
- `--window <date>` — override the window start (attended diagnosis only).

## Window

Anchor on the newest report in `reports/tool-friction/`. The window is **from that
report's date to now** — a skipped run widens the window rather than dropping it.
If no report exists (first run), take everything transcript retention still holds
and say so in the report. Claude Code prunes old sessions; the store is the bound,
not the calendar.

## Sources

Session transcripts for **this repo only**: every directory under
`~/.claude/projects/` whose decoded path is this repo's main checkout or one of
its linked worktrees (`git worktree list`), `*.jsonl` files within the window by
mtime. Explicitly out of scope: any other project's transcript store — in
particular the org vault's. If the transcript root is unreadable, stand down and
write a report saying so; do not widen the search.

## Privacy — hard rules, checked before every push

Transcripts can contain private material: reads of gitignored files (including
`agent-os/product/*`, which names the customer and prospects), credentials in
command output, personal context. Therefore, in every **public artifact** of this
run — branch names, commit messages, PR titles, PR bodies:

- **Never quote transcript text.** Describe the friction pattern generically:
  "agents repeatedly retried `bd` from subdirectories where it fails" — not the
  actual session excerpt.
- **Never reference private-file contents or names of people/organizations** that
  appear only in private material.
- **Never include session IDs, transcript paths, or bead IDs** (per
  `git-workflow`).
- Error messages emitted by the tools themselves (e.g. a CLI's own usage error)
  may be quoted if they contain no repo-external or private content.

Specifics — quotes, session IDs, timestamps, tallies — belong in the gitignored
report only. Before `git push`, re-read the diff and PR body against this list.

## Method

1. **Inventory.** Enumerate in-window transcripts; note count, span, total size.
2. **Mine.** Scan for tool-error signatures: failed tool calls and what the agent
   did next (retries, workarounds, re-derivations); repeated identical failures
   across sessions; permission-prompt stalls; commands re-learned every session
   (flags rediscovered, cwd mistakes, unsupported options); misleading output that
   sent an agent down a wrong path.
3. **Cluster and cost.** Group into named friction patterns. For each: occurrence
   count, sessions affected, rough time/turn cost, and the signature of the wasted
   work. Discard one-offs unless the single cost was large.
4. **Map to a fix target.** For each pattern, identify the *smallest instruction
   change* that would have prevented it, and the right home: the specific skill
   that governs that activity, the relevant `.agents/commands/*.md`, AGENTS.md /
   CLAUDE.md, or agent config (e.g. a permissions allowlist entry). If no
   instruction change would help (the tool itself is broken), record it in the
   report as out of scope — do not propose code changes.
5. **Rank.** Order patterns by recurring time cost × confidence the fix prevents
   it.
6. **Propose.** For the top patterns, **at most 3 PRs per run**, one pattern per
   PR: branch off freshly-fetched `origin/main`, make the instruction edit, commit
   and open the PR per `git-workflow` (conventional commit, concise title/body).
   The PR body states the pattern generically, the observed frequency, and why
   this fix at this home. **Leave every PR unmerged.** Patterns above the cap go
   to the report as *deferred (cap)*.

## Scheduled mode (`--scheduled`)

**Queue gate — before opening any PR.** Using `gh pr list`, count open non-draft
PRs that are passing CI and have no unresolved change request. If that count is
**10 or more**, or the **oldest** such PR is **older than 7 days**, stand down:
open nothing and write a short report recording the gate reading. The two values
are fixed constants sized to the maintainer's review capacity — they change only
by a deliberate edit to this command, never inline by a running agent.
Investigation (steps 1–5) may still run; the report is still written.

**Per-run report.** Write `reports/tool-friction/<YYYY-MM-DD>.md` in the workspace
(`reports/` is gitignored — verify with `git check-ignore`, add the pattern if
missing). Contents:

- window covered (anchor report date → now) and transcript inventory (count, span)
- the queue-gate reading (counts and verdict, even when the run proceeded)
- every friction pattern found: name, evidence (quotes and session IDs allowed
  here — local only), occurrence count, cost estimate
- the **proposed** table: PR number, pattern, fix target
- *deferred (cap)* and *out of scope (not an instruction fix)* lists, with reasons
- a one-line self-check that the privacy list was applied to every public artifact

## Acceptance / manual verification

No automated tests. After an edit to this command:

1. `/tool-friction-retro --dry-run` — confirm a report with named patterns and
   zero PRs, zero branches.
2. A full attended run — confirm ≤ 3 PRs, all unmerged, all touching only
   instruction/config files; read each PR body against the privacy list.
3. For `--scheduled`: with 10+ qualifying PRs open (or a stale one), confirm the
   run stands down and writes a gate-reading report with zero PRs; confirm the
   report path is gitignored (`git check-ignore reports/tool-friction/x.md`).
