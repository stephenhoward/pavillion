---
name: Documentation Playbook
description: Voice and structure standards for Pavillion user-facing documentation. Use this skill when writing or revising guides in docs/guides/, when evaluating documentation drafts for tone and scope, or when checking that new docs land in the same voice as the marketing site at pavillion.social.
---

# Documentation Playbook

This Skill provides voice and structure standards for the Pavillion user-facing documentation in `docs/guides/`. Use it when writing a new guide, revising an existing one, or evaluating a draft.

Pavillion documentation has a dual purpose: **teach the software well enough that someone can use it, AND help the reader become a better calendar owner, organizer, or administrator.** Voice and structure decisions follow from that dual purpose.

## Reference Sources

| Source | What it gives you |
|--------|-------------------|
| [./principles.md](./principles.md) | The substantive standards: voice principles, patterns, anti-patterns, length and scope rules, pre-publish checklist |
| `docs/guides/calendar-owners/categories.md` and `places.md` | The most-developed exemplars of the voice in practice — verbatim quotes in `principles.md` are excerpted from these |
| https://pavillion.social/ | The marketing-site voice these guides extend into reference material |

## Routing Guide

| If you are... | Read these sections of principles.md |
|---------------|--------------------------------------|
| Writing a new guide from scratch | All sections |
| Adding a section to an existing guide | Voice principles + Patterns we use + Things we avoid |
| Reviewing a draft | Things we avoid + Checklist |
| Deciding whether a topic deserves a full guide or a stub | Notes on length and scope |
| Calibrating tone before writing the first sentence | Voice principles + Continuity with the marketing site |

## Instructions

1. Read [./principles.md](./principles.md) for the standards.
2. Skim at least one developed exemplar (`docs/guides/calendar-owners/categories.md` or `places.md`) to see the voice in practice — the verbatim quotes in `principles.md` come from these.
3. Apply the voice principles when drafting; apply the anti-patterns and checklist when reviewing the result.
4. When the dual-purpose layer (organizer judgment alongside mechanics) doesn't fit naturally for a topic, prefer omitting it over forcing it. Not every guide needs to read like `categories.md`.
5. A stub that telegraphs planned scope (`> Status: stub. Full guide coming before launch.` followed by bulleted scope) is better than a thin half-guide.

## Related Skills

This skill covers user-facing documentation in `docs/guides/`. It does not cover:

- **Code comments** — see `global-commenting`
- **Commit messages** — see `git-workflow`
- **Beads issue descriptions** — see beads workflow skills
- **Design docs / specs** — see `architecture-playbook`, `complexity-playbook`

If a doc is for end users (calendar owners, instance administrators, contributing developers reading guides about how to contribute), this skill applies. If it's a code artifact or an internal planning document, it doesn't.
