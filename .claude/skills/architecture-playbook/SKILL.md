---
name: Architecture Playbook
description: Pavillion architectural clarity standards. Use this skill when evaluating whether specs or code align with the product's architectural vision, maintain conceptual integrity, or respect documented architectural decisions.
---

# Architecture Playbook

This Skill provides Claude Code with architectural clarity standards specific to the Pavillion codebase. Use it when reviewing specs for product vision alignment, auditing code for conceptual integrity, or checking that implementations respect documented architectural decisions.

## Context

Pavillion is a federated events calendar with a clear product mission, documented architectural decisions, and a phased roadmap. These standards evaluate whether specs and code maintain the product's **conceptual integrity** -- whether the system reads as one coherent product or a collection of well-built but disconnected pieces.

These standards complement (but do not replace) the other playbook skills:
- `consistency-playbook` -- "Does this match what we do elsewhere?" (convention-level)
- `complexity-playbook` -- "Is this too much?" (scope and simplicity)
- `security-playbook` -- "Is this safe?" (vulnerabilities and trust)

Where those skills check code-level patterns, architecture standards check **product-level alignment**.

## Product Documents Referenced

Architecture review is grounded in three product-level documents:

| Document | What it tells us |
|----------|-----------------|
| `agent-os/product/mission.md` | Product vision, target users, differentiators, key features |
| `agent-os/product/decisions.md` | Documented architectural decisions with rationale and consequences |
| `agent-os/product/roadmap.md` | Development phases, priorities, and current implementation status |

## Routing Guide

| If the spec or code involves... | Read these sections of principles.md |
|--------------------------------|--------------------------------------|
| New features, new concepts, new domains | Conceptual Integrity |
| Overriding or ignoring a documented decision | Decision Adherence |
| Unclear rationale, lost "why" between layers | Narrative Coherence |
| Ownership ambiguity, overlapping domains | Responsibility Clarity |
| Federation behavior, local vs. shared data | Federation Model Alignment |
| Roadmap drift, tangential features | Product Direction |

## Instructions

For all architecture dimensions, refer to:
[principles](./principles.md)

The principles file covers: conceptual integrity, decision adherence, narrative coherence, responsibility clarity, federation model alignment, and product direction.

When reviewing:

1. Read the product documents (mission, decisions, roadmap) for context
2. Identify which architecture dimensions are relevant to the spec or code under review
3. Read the relevant sections of `./principles.md`
4. Evaluate whether the spec/code maintains the product's conceptual integrity

- For **spec review** (pre-implementation): Focus on the "In specs" red flags in each dimension
- For **code audit** (post-implementation): Focus on the "In code" red flags in each dimension
