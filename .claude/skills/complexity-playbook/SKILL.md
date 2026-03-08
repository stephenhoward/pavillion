---
name: Complexity Playbook
description: Pavillion complexity and maintainability standards. Use this skill when evaluating code or specs for unnecessary complexity, YAGNI violations, pattern drift, or maintainability concerns.
---

# Complexity Playbook

This Skill provides Claude Code with complexity and maintainability standards specific to the Pavillion codebase. Use it when reviewing specs for scope creep, auditing code for unnecessary complexity, or checking that implementations follow established patterns.

## Context

Pavillion is maintained by a very small group (currently one person). These standards are calibrated for that reality. What might be "reasonable" complexity for a 10-person team is over-engineering here. The core litmus test for all decisions:

> **Can a solo maintainer understand, debug, and modify this 6 months from now without context?**

## Routing Guide

| If the spec or code involves... | Read these sections of principles.md |
|--------------------------------|--------------------------------------|
| New features, "while we're here" additions | Scope Creep |
| Abstractions, config, parameterized interfaces | YAGNI |
| New patterns, naming, architectural choices | Consistency |
| Long functions, deep nesting, coupled modules | Maintainability |
| Indirection layers, wrappers, generalizations | Simplicity |

## Instructions

For all complexity dimensions, refer to:
[principles](./principles.md)

The principles file covers: scope creep, YAGNI, consistency, maintainability, and simplicity -- each with **Threats**, **Red Flags**, and **Safe Patterns**.

When reviewing:

1. Identify which complexity dimensions are relevant to the spec or code under review
2. Read the relevant sections of `./principles.md`
3. Apply the Threats, Red Flags, and Safe Patterns from each section
