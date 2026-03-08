---
name: Consistency Playbook
description: Pavillion pattern consistency standards. Use this skill when evaluating code or specs for convention drift across APIs, data models, services, components, tests, or translations.
---

# Consistency Playbook

This Skill provides Claude Code with pattern consistency standards specific to the Pavillion codebase. Use it when reviewing specs for convention alignment, auditing code for pattern drift, or checking that implementations follow established naming, structure, and organization conventions.

## Routing Guide

| If the spec or code involves... | Read this companion file |
|--------------------------------|--------------------------|
| API endpoints, route handlers, HTTP responses | [./api-interface.md](./api-interface.md) |
| Sequelize entities, domain models, exceptions | [./data-model.md](./data-model.md) |
| Service methods, validation, cross-domain calls | [./service-layer.md](./service-layer.md) |
| Domain boundary imports, DI patterns, event bus | [./service-layer.md](./service-layer.md) |
| Vue components, Pinia stores, composables | [./ui-components.md](./ui-components.md) |
| Test files, mocking, assertions | [./test-patterns.md](./test-patterns.md) |
| Translation keys, locale files, i18n usage | [./i18n-keys.md](./i18n-keys.md) |

## Topic Files

| File | Scope |
|------|-------|
| [./api-interface.md](./api-interface.md) | Route registration, HTTP verbs, parameter naming, error response shapes, auth check patterns, response serialization |
| [./data-model.md](./data-model.md) | Entity decorator patterns, toModel/fromModel, toObject/fromObject, property casing, exception hierarchy |
| [./service-layer.md](./service-layer.md) | Method signature conventions, validation in services, domain exceptions, event bus usage, interface delegation, domain boundary imports, DI patterns |
| [./ui-components.md](./ui-components.md) | Script setup import order, props with TypeScript, store-service pattern, Pinia store conventions, composables |
| [./test-patterns.md](./test-patterns.md) | Describe naming, sinon sandbox lifecycle, stub patterns, assertion style, test file location |
| [./i18n-keys.md](./i18n-keys.md) | snake_case keys, namespace-per-feature, key hierarchy, interpolation patterns, error/aria/success prefixes |

## Instructions

The companion files in this skill directory contain established conventions, examples, and known drift for each code area. Read only the files relevant to your current task.

When reviewing code:

1. Identify which topics are relevant to the spec or code under review
2. Read only the relevant companion files
3. Apply the **Established Convention**, **Examples**, and **Known Drift** sections from each file
4. When inconsistency is found, apply the **Justified Divergence Framework** below before flagging

## Justified Divergence Framework

Not all inconsistency is accidental drift. Sometimes code intentionally deviates from established patterns for good reason. Before flagging an inconsistency, check whether it meets one of these four criteria:

### 1. Genuine Structural Difference

The code operates in a structurally different context where the standard pattern doesn't apply.

**Example:** The `public/` domain wraps `CalendarInterface` rather than having its own independent services, because public endpoints are a filtered view of calendar data -- not a separate domain with its own entities.

**Test:** "Would applying the standard pattern here require creating artificial structures just to match the convention?"

### 2. Pattern Evolution

The divergence represents an improvement over the established pattern, and the team has decided (or should decide) to migrate toward it.

**Example:** Newer components use `defineProps<{ title: string }>()` with TypeScript generics while older components use `defineProps({ title: String })` with runtime declarations. The generic form is the newer Vue 3 convention.

**Test:** "Is the 'inconsistent' code actually better? Should the convention be updated to match it instead?"

### 3. Fundamentally Different Domain

The domain has requirements that make the standard pattern genuinely inappropriate.

**Example:** The ActivityPub domain uses different error handling because federation errors must be serialized as ActivityPub JSON-LD, not the standard `{ error, errorName }` shape used by internal APIs.

**Test:** "Does this domain have external protocol requirements or constraints that override internal conventions?"

### 4. No Existing Precedent

The code is the first of its kind in the codebase, so there's no pattern to follow.

**Example:** The widget SDK build configuration (`vite.widget-sdk.config.ts`) has no precedent -- it's the only non-app build target.

**Test:** "Is there actually an established pattern for this kind of code, or is this genuinely new ground?"

### Using the Framework

1. **Identify the inconsistency** -- what convention does the code diverge from?
2. **Check the four criteria** -- does any criterion apply?
3. **If yes** -- note the divergence but classify it as "justified" with the criterion
4. **If no** -- flag it as drift that should be corrected
5. **If uncertain** -- flag it as "potential drift, verify intent" and let the developer decide

The framework exists to prevent false positives. Convention conformance for its own sake isn't the goal -- the goal is reducing cognitive load. If a divergence has a clear reason and doesn't increase cognitive load, it's not a problem.
