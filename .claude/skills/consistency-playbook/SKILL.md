---
name: Consistency Playbook
description: Pavillion pattern consistency standards. Use this skill when evaluating code or specs for convention drift across APIs, data models, services, components, tests, or translations.
---

# Consistency Playbook

This Skill provides pattern consistency standards specific to the Pavillion codebase. Use it when reviewing specs for convention alignment, auditing code for pattern drift, or checking that implementations follow established naming, structure, and organization conventions.

## Topic Files

| If the spec or code involves... | Read this file |
|--------------------------------|----------------|
| API endpoints, route handlers, HTTP responses, domain interfaces | [./api-interface.md](./api-interface.md) |
| Sequelize entities, domain models, exceptions, serialization | [./data-model.md](./data-model.md) |
| Service methods, validation, cross-domain calls, domain boundary imports, DI patterns, event bus | [./service-layer.md](./service-layer.md) |
| Vue components, Pinia stores, composables, frontend services | [./ui-components.md](./ui-components.md) |
| Test files, mocking, assertions, test organization | [./test-patterns.md](./test-patterns.md) |
| Translation keys, locale files, i18n usage | [./i18n-keys.md](./i18n-keys.md) |

## Instructions

The companion files contain **Established Convention**, **Examples**, and **Known Drift** sections for each code area. Read only the files relevant to your current task.

When reviewing:

1. Identify which topics are relevant to the spec or code under review
2. Read only the relevant companion files
3. Check the spec or code against each file's **Established Convention** and **Known Drift** sections
4. When inconsistency is found, apply the **Justified Divergence Framework** below before flagging

## Justified Divergence Framework

Not all inconsistency is accidental drift. Before flagging an inconsistency, check whether it meets one of these four criteria:

### 1. Genuine Structural Difference

The code operates in a structurally different context where the standard pattern doesn't apply.

**Test:** "Would applying the standard pattern here require creating artificial structures just to match the convention?"

**Example:** The `public/` domain wraps `CalendarInterface` rather than having its own independent services, because public endpoints are a filtered view of calendar data — not a separate domain with its own entities.

### 2. Pattern Evolution

The divergence represents an improvement over the established pattern.

**Test:** "Is the 'inconsistent' code actually better? Should the convention be updated to match it instead?"

**Example:** Newer components use `defineProps<{ title: string }>()` with TypeScript generics while older components use runtime declarations. The generic form is the newer Vue 3 convention.

### 3. Fundamentally Different Domain

The domain has requirements that make the standard pattern genuinely inappropriate.

**Test:** "Does this domain have external protocol requirements or constraints that override internal conventions?"

**Example:** The ActivityPub domain uses different error handling because federation errors must be serialized as ActivityPub JSON-LD, not the standard `{ error, errorName }` shape.

### 4. No Existing Precedent

The code is the first of its kind in the codebase, so there's no pattern to follow.

**Test:** "Is there actually an established pattern for this kind of code, or is this genuinely new ground?"

**Example:** The widget SDK build configuration (`vite.widget-sdk.config.ts`) has no precedent — it's the only non-app build target.

### Using the Framework

1. **Identify the inconsistency** — what convention does the code diverge from?
2. **Check the four criteria** — does any criterion apply?
3. **If yes** — note the divergence but classify it as "justified" with the criterion
4. **If no** — flag it as drift that should be corrected
5. **If uncertain** — flag it as "potential drift, verify intent" and let the developer decide

The framework prevents false positives. Convention conformance for its own sake isn't the goal — the goal is reducing cognitive load.
