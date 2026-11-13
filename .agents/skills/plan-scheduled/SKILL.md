---
name: plan-scheduled
description: Use when running `/plan --scheduled` (the unattended spec pipeline), when reading or writing a `spec:*` label, a `Decisions made for you`, `Advisory Review` or `Planned hierarchy` notes block, or the `reports/spec-plan/` run report, or when another command needs to know which `spec:*` labels the scheduled planner owns (the build labels `spec:building`, `spec:built` and `spec:stalled` belong to build-scheduled).
---

# Plan, scheduled

The unattended mode of `/plan`, modelled on `/clear-backlog --scheduled`. It
never waits on a human: every question the attended command would ask is
answered by best judgement and written on the bead, and every run writes a
report file. `/plan --scheduled` refuses a bead id, `--until`, `--reshape` or
`--readvise`: the selection rules are the whole input, and a hybrid would be
an untested path.

## Reference files

Read the file for the task at hand. Each is self-contained apart from the
cross-references it names.

| Task | File |
|---|---|
| Setting, clearing or interpreting a `spec:*` label; writing or parsing a `Decisions made for you` or `Advisory Review` block; design rulings | [labels-and-blocks.md](labels-and-blocks.md) |
| Taking a `spec:approved` or `spec:decomposing` root to `spec:ready` (plan, decompose, analyse, gate) | [approved-pass.md](approved-pass.md) |
| Re-drafting a `spec:revise` root | [revise-pass.md](revise-pass.md) (reads drafting-pass.md too) |
| Drafting and advising a new `office:*` root; the refuse-rather-than-guess list | [drafting-pass.md](drafting-pass.md) |
| Writing the per-run report | [report.md](report.md) |

A full run reads every file: approved pass, then revise, then drafting, then
the report.

## Overrides of the attended flow

The attended phases in `.agents/commands/plan.md` (DRAFT, ADVISE,
CONFIRM-AND-WRITE, DECOMPOSE, ANALYZE) apply as written, except:

- No AskUserQuestion. Where the attended flow would ask, decide, and record it
  as labels-and-blocks.md's *Note blocks* says.
- Skip Step 0a, and never list, resume, delete or write drafts under
  `docs/.scratch/`; they may belong to an attended session.
- Skip the CONFIRM-AND-WRITE approval gate and the menu phases
  `### Phase DECOMPOSE prompt` and `### Phase ANALYZE prompt`; the approved
  pass still spawns the `### Phase DECOMPOSE` and `### Phase ANALYZE`
  subagents. The per-run report replaces Step Final.
- Add `advised` only when an advisor ran and none still requests changes
  (agent-discovery: never advance as if review passed).
- Never change a bead's status: `open` is part of every selection, so a
  claimed root would drop out of every later run. Never set `spec:approved`
  or `spec:revise`. Never add `needs-human` or call
  `.agents/tools/bead.ts escalate`; where agent-discovery would escalate a
  persistent REQUEST CHANGES, this mode blocks the root.

## Tooling

The deterministic half lives in `scripts/spec.ts`; the pass files cite it
rather than restate a query. `spec.ts <command>` always means the full
`npx tsx .agents/skills/plan-scheduled/scripts/spec.ts <command>` — spell it
out in every call (the Bash tool's zsh does not word-split a `$S` variable,
and shell functions do not survive between calls):

```
select <drafting|approved|revise>   JSON rows: pass candidates, by priority then oldest
inspect <root>                      JSON: status, labels, field presence, last_heading, routing headings
leaves <root>                       JSON rows: leaves still to analyse
last-block <root> "<heading>"       text: body of the last block with that heading; exit 1 if none
revise-note <root>                  text: the maintainer's note, empty if none
revision-number <root>              JSON {revision}: N for the next "(revision N)" blocks
gate-misses <root>                  JSON {misses}: misses since the last restart
state-write <spec:label>            text: the bd update flags of a state write
```

A heading test ("has a Planned hierarchy heading") means `inspect`'s
`headings` field: a markdown heading of any level or case, never a plain
substring. Tests: `npx vitest run --config .agents/tools/vitest.config.ts`.

## Order of work

Each run takes the **approved pass** (no cap), the **revise pass**, then the
**drafting pass**. The last two share a cap of **2** roots per run; revised
roots run first, so the drafting pass takes `2 − revised-this-run`, which
counts every revise-pass root selected, refused or *skipped (taken mid-run)*
included. The rest are *not taken (cap)*.

## Write discipline

Every pass writes under these rules:

- **State write.** A state write to `<target>` is the flags
  `spec.ts state-write <target>` prints, appended to the same `bd update` as
  the fields and notes it accompanies.
- **One call per write.** Each write is **one** `bd update` with its fields,
  notes and labels: a cut before it leaves the next run to redo the step from
  the same input, where split calls could leave an Advisory Review block with
  no `spec:*` label, and that root would drop out of every pass.
- **Files.** Pass every text as `"$(cat <file>)"` from a file in the session
  scratchpad; a heredoc inside `$()` breaks on bash 3.2.
- **Append only.** Notes take `--append-notes`, never `--notes`; never edit an
  earlier block. Readers take the **last** block of each name.
- **Mid-run re-read.** Before every write, `spec.ts inspect` the root. If it
  is no longer `open`, now carries `needs-human`, or lacks the label that
  selected it, someone took it this run: write nothing; report *skipped
  (taken mid-run)*.
- **needs-human.** Every selection flags `needs_human`. Such a root is not
  selected, takes no cap slot, and is reported *skipped (needs-human)*.
