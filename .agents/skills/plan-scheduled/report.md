# Per-run report

Every scheduled run ends by writing `reports/spec-plan/<YYYY-MM-DD>.md`
(`$(date +%F)`) in the workspace, appending a `## Run <HH:MM>` section if the
file exists. `reports/` is gitignored — verify with `git check-ignore`, and
add the pattern if missing. This replaces the attended command's Step Final.

Contents, from the *Report lines* section of each pass file:

- each root touched: id, title, pass, resulting label, advisor verdict lines,
  count of decisions made, and any refusals or errors
- each revise-pass root: revision number, and whether the note was fully
  addressed
- each approved-pass root: its leaf count (`1 (the root)` for a single-bead
  root), or the leaves still unanalysed if it stays `spec:decomposing`; each
  `Decide:` leaf it created, for the maintainer to decide; and whether the
  gate bound blocked it, with what never completed
- the roots *skipped (taken mid-run)*, *skipped (needs-human)*, or skipped by
  the approved pass for also carrying `spec:revise`; and those
  **not taken (cap)**, with priority and title

The report is local and gitignored, so bead IDs are allowed there — they
remain forbidden in branches, commits, and PRs.
