# Drafting pass

Drafts and advises open `office:*` roots nobody has planned yet, and ends
each on a row of *Outcome labels* (labels-and-blocks.md). The revise pass
reuses this file's *Refuse rather than guess*, **Advise** and **Write**
steps. The write discipline (one call, append only, mid-run re-read) is in
SKILL.md.

## Select

`spec.ts select drafting` lists the candidates: open `office:*` roots
carrying no `spec:*` label and no Advisory Review heading, none of whose
children is `in_progress` or `closed` (started children mean shipped work;
all-open children are author-written, part of the brief). Take as many rows
not flagged `needs_human` as *Order of work* (SKILL.md) leaves. The rule
lives in `selectDrafting` in `scripts/lib/spec.ts`; amend it there and
nowhere else.

## Draft

Treat the bead's existing description as the brief. Keep it verbatim, open
it with a short plain-language paragraph, and extend it with scope and
success criteria; do not replace the author's reasoning. Read any children
(`bd children <id>`) as part of the brief: the design accounts for them, but
does not restructure them. As in attended DRAFT (`.agents/commands/plan.md`),
skip a sub-step whose field is populated, except the description. Sub-step 1
is answered from the brief; sub-step 2 (visuals) is skipped, and the design
says so; sub-steps 3–7 run as written.

## Refuse rather than guess

Refuse when drafting would require any of these, unless a design ruling
(labels-and-blocks.md) settles it:

- changing a public URL or slug shape: anything that changes
  `src/common/routing/public-paths.ts`, `src/common/routing/reserved-segments.ts`,
  `src/site/routes.ts`, or calendar or series url-name rules (DEC-018);
- changing federation semantics: which activities are emitted or accepted,
  their type, addressing or object shape, actor-document properties, or inbox
  and outbox trust rules (DEC-013, DEC-014, DEC-015 *federated report routing*);
- a destructive data migration: dropping or renaming a column or table, or
  deleting or irreversibly rewriting rows;
- contradicting, amending or superseding a decision in `docs/decisions/` whose
  Status is Accepted, or any still-in-force clause of a decision, whatever its
  file's Status, such as adopting an ActivityPub library (DEC-012) or `@` in
  public URLs (DEC-006). Decision text has override priority, so changing one
  is the product owner's call. Proposing a brand-new DEC is not a refusal;
  record it under *Decisions made for you*.

On a refusal, write whatever fields are complete, skip ADVISE (an Advisory
Review block would make the bead read as advised), make the refusal the first
*Decisions made for you* item, and end on the refusal row.

## Advise

Run Phase ADVISE as written in `.agents/commands/plan.md` — same discovery
(`npx tsx .agents/skills/agent-discovery/scripts/agents.ts advisor`), same
single Task batch, same plan template — except:

- On APPROVE WITH CONDITIONS or REQUEST CHANGES, adjust the draft yourself,
  re-run only the affected advisors once, and add an `- adjusted for` line.
- If no advisor plausibly applies, proceed without `advised`.
- If REQUEST CHANGES survives the single refinement, still write the fields
  and both blocks, end on that row, and stop on that root.

## Write

Re-read the root (*Mid-run re-read*: it must carry no `spec:*` label), then
write what CONFIRM-AND-WRITE writes, unprompted, in one call with the
*Outcome labels*, dropping the flag of any field not written:

```bash
F=<session-scratchpad>/<id>
bd update <id> --description "$(cat $F-description.md)" \
  --design "$(cat $F-design.md)" --acceptance "$(cat $F-acceptance.md)" \
  --append-notes "$(cat $F-notes.md)" \
  --add-label shaped --add-label advised \
  $(npx tsx .agents/skills/plan-scheduled/scripts/spec.ts state-write spec:drafted)
```

The notes file holds references, applicable standards, `## Advisory Review`
(omitted on a refusal) and `## Decisions made for you`, in that order. A cut
before the write leaves the root as the bead's author left it, so the next
run drafts from the original brief without doubling the opening paragraph.
Read back with `bd show <id>` and run the CONFIRM-AND-WRITE checklist. Stop
there: **no decomposition and no analysis in this pass**, and no children
created.

## Report lines

For report.md: id, title, resulting label, advisor verdict lines, count of
decisions made, any refusals; rows *skipped (needs-human)* and
*not taken (cap)* with priority and title.
