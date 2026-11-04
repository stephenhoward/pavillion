# Revise pass

Re-drafts roots sent back with `spec:revise` as `--reshape` does, re-advises
them as `--readvise` does, under the drafting pass's rules, and ends each on
a row of *Outcome labels* (labels-and-blocks.md). Read drafting-pass.md too:
steps 3–5 reuse its *Refuse rather than guess*, **Advise** and **Write**.
Roots are `spec.ts select revise`, in the printed order; each counts against
the shared cap in *Order of work* (SKILL.md).

## 0. Check it was only drafted

`spec.ts inspect <id>` is this step's read and the *Mid-run re-read* for the
refusals below. A root with a Planned hierarchy heading has been through the
approved pass; re-drafting would leave its children or Implementation Context
describing a different spec. Refuse it: number the revision (step 2) and, in
one call, append only a `## Decisions made for you (revision N)` block whose
first item is
`- **Q:** Re-draft this root? — **A:** refused — it was already decomposed; edit its leaves by hand, keeping their titles, then set spec:approved to resume`,
with a state write to `spec:blocked`.

## 1. Read the note

`spec.ts revise-note <id>` prints it: the body of a dated
`revision (<YYYY-MM-DD>)` heading the maintainer's tooling wrote after the
last Decisions block, or else plain text appended by `bd note` after that
block's items. Either runs to the next heading, so a note may not contain
headings of its own, and a following Design ruling block is never the note.
If it prints nothing, a re-draft would be a guess: refuse as in step 0, with
`- **Q:** Re-draft this root? — **A:** refused — spec:revise with no note after the last Decisions block`.

## 2. Number the revision

`spec.ts revision-number <id>`: 1 + the count of
`Decisions made for you (revision K)` headings, not Advisory Review ones,
which a refused revision does not write.

## 3. Re-draft

Only the fields the note affects, as `--reshape` re-runs DRAFT, holding each
in context until step 5. Every drafting-pass rule applies: the overrides in
SKILL.md, *Refuse rather than guess*, and the author's reasoning kept
verbatim without a second opening paragraph. A design ruling appended after
the last Decisions block is newer than the spec: apply it. A note asking for
a change on the refuse list is refused; where it can be partly addressed
without that change, do that part and refuse the rest; the done part is
still re-advised in step 4, which overrides the drafting pass's
skip-ADVISE-on-refusal rule.

## 4. Re-advise

As `--readvise` re-runs ADVISE: the drafting pass's **Advise** step, with the
whole revised plan given to every matched advisor. Skip it only when step 3
re-drafted no field.

## 5. Write

Re-read the root (*Mid-run re-read*: it must still carry `spec:revise`), then
write with the drafting pass's **Write** call and file layout, with only the
re-drafted fields, and `F=<session-scratchpad>/<id>-rev<N>`. The notes file
holds, in order: `## Advisory Review (revision N)` (omitted when no field was
re-drafted); `## Revision notes (revision N)`, saying how the note was
addressed, what was not, and why; then `## Decisions made for you (revision N)`,
holding only refusals and open questions per labels-and-blocks.md, or `none`.
Read back with `bd show <id> --json | jq -r '.[0].notes'`: the new blocks
follow every earlier one, unchanged.

## Report lines

For report.md: id, title, revision number, resulting label, advisor verdict
lines, whether the note was fully addressed, and any refusal.
