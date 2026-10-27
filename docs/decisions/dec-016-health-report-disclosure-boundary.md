# DEC-016: The Public Health-Report Disclosure Boundary

> Date: 2026-08-29
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead

## Decision

The rolling `health-report` GitHub issue is public, and the weekly Trivy triage writes to it. What that comment may say about a vulnerability is bounded, and the boundary is drawn around the **reachability conclusion**, not around the CVE identity.

The triage comment **may**:

- name a CVE **added to** the base-image watch list, or **pruned from** it;
- report escalations off the watch list **only as a count** — `1 finding escalated off the watch list; details on the bead`.

The triage comment **may not** carry:

- the **identity of an escalated CVE**;
- the reachability reasoning, or which files or call sites were checked;
- the affected code path, entry point, or configuration;
- the fact that a reachable CVE currently has no upstream fix and no mitigation in place.

The same restraint applies to quoting a watch-row note: summarize as "assessed, not reachable" rather than reproducing the analysis.

The exploitability analysis lives on the bead. Escalated CVE ids are named in the chat report to the maintainer and nowhere else.

This decision also names the maintainer concept the workflow introduced and left unnamed: an **accepted security risk, recorded on a rolling watch bead**. A no-fix CVE that has been assessed as not reachable in Pavillion's container is not ignored and not tracked as actionable work — it is a risk knowingly carried, with the assessment and its evidence recorded on the single rolling "Base-image CVE watch" bead, re-examined every week until a fix ships or the finding is pruned.

The operational procedure that implements this decision is step 7 of the `triage-health` skill (`.agents/skills/triage-health/SKILL.md`). This file records **why** the boundary sits where it does; the skill records how to apply it.

## Context

The weekly Trivy scan (`.github/workflows/health.weekly.yaml`) posts findings to a rolling GitHub issue labelled `health-report`. That issue is public, and its body already names CVEs, packages and severities. Triage turns the scan into tracked work: actionable beads for what can be fixed, a rolling watch bead for what cannot, closures for what has gone away, and one summary comment on the issue as the audit trail.

Two properties of the current setup make this boundary load-bearing rather than a matter of taste:

- **`.beads/**` is gitignored.** The bead that holds an exploitability analysis is private *because of a gitignore entry*, not because of any access control. That gitignore entry is therefore a security-disclosure mechanism, and nothing in `.gitignore`, `AGENTS.md`, or any other decision file said so before this one.
- **The repository has no `SECURITY.md`.** Until one exists, step 7 of a skill file loaded on demand is the de facto vulnerability-disclosure posture for the project. A maintainer filing an escalation bead by hand, or later writing a real disclosure policy, had no reason to find it there.

The analysis this file records was not invented here. It already existed inside the skill; this is relocation, so that the policy is discoverable outside a file that only gets loaded when the weekly triage runs.

## Alternatives Considered

1. **Leave the policy in `SKILL.md` only**
   - Pros: Single source; no duplication between a skill and a decision record
   - Cons: Discoverable only by whoever is running `/triage-health`. Leaves the `.beads/` gitignore coupling invisible: whoever later proposes tracking `.beads/` in git has no reason to know they would be publishing reachability analysis. Leaves a human filing an escalation bead by hand with no statement of what may be said publicly.

2. **Write a `SECURITY.md` instead**
   - Pros: The conventional, externally-visible home for a disclosure policy; GitHub surfaces it
   - Cons: A `SECURITY.md` addresses *inbound* reports from third parties — how to report a vulnerability, what response to expect. This boundary governs *outbound* publication by our own automation. The two overlap but are not the same document, and writing the outbound rule as a public promise commits to a posture that has not been decided. A `SECURITY.md` remains worth writing; this decision is a prerequisite for it, not a substitute.

3. **Record it as a product decision, with the skill retained as the procedure** (Selected)
   - Pros: Puts the rationale and its couplings where the other constraints of this kind live and where the index's Consult-when triggers can route a reader to it; keeps the operational detail in the skill that executes it; gives a future `SECURITY.md` author something to build on
   - Cons: Two files describe one policy, and they can drift. Mitigated by scope split: this file carries the boundary and the why, the skill carries the procedure.

## Rationale

An escalation means, **by construction**: no upstream fix published, no mitigation applied yet, and a confirmed reachable path in the image running in production. Naming an escalated CVE in a public comment publishes that whole combination, because that is what the word "escalated" means in this workflow.

The CVE identity by itself is not the sensitive part — the public issue body already names CVEs, packages and severities, and so do the upstream advisories. The **reachability conclusion** is the sensitive part. It is authored by this workflow, against this repository's Dockerfile, dependency tree and call sites, and it is public nowhere else. A watch-list add or prune leaks nothing, because it says only that a scanner reported something and that we are tracking it. An escalation, named, is a live pointer to an unfixed and unmitigated reachable path.

Reporting escalations as a bare count preserves the audit trail — a reader can see the workflow ran, and how much it escalated, without learning which finding to go looking for.

**This is not a DEC-004 question.** [DEC-004](dec-004-privacy-first-public-access.md) governs anonymous attendee access and attendee data collection; this workflow touches no user data at all. The gap this file closes is that no decision record covered vulnerability handling or disclosure in any form.

## Consequences

**Positive:**

- The disclosure boundary and its rationale are discoverable outside an on-demand skill file.
- The coupling between `.beads/**` being gitignored and the project's security-disclosure posture is written down, with an index trigger on it. A proposal to track `.beads/` in git now has somewhere to collide with this decision before it lands.
- The maintainer-facing concept "accepted security risk, recorded on a rolling watch bead" has a name in the product vocabulary.
- A future `SECURITY.md` author has a stated outbound posture to build on rather than reverse-engineer.

**Negative:**

- One policy is now described in two places (this file and `triage-health` step 7) and can drift. The split is deliberate — boundary and rationale here, procedure there — but a change to what may be published has to be made in both.
- The public audit trail is deliberately incomplete: a reader of the health issue cannot reconstruct which findings were escalated. That information is on the bead and in the chat report, both private.
- Because the bead's privacy rests on a gitignore entry rather than on access control, the posture is only as strong as that entry. Anyone with a checkout of the working tree has the analysis.
