---
name: Stylesheet Playbook
description: Pavillion SCSS/CSS quality standards. Use this skill when evaluating code or specs for stylesheet issues including duplication, misplacement, token misuse, dark mode gaps, and design system drift.
---

# Stylesheet Playbook

This Skill provides stylesheet quality standards specific to the Pavillion codebase. Use it when reviewing specs for styling approach, auditing code for stylesheet issues, or checking that implementations follow established design system patterns.

## Automated formatting (stylelint)

Mechanical formatting — 2-space indentation and a final newline in `.scss` files and Vue `<style>` blocks — is enforced automatically by **stylelint** and is **not** something this playbook needs to flag. Run `npm run lint:style` to check and `npm run lint:style:fix` to auto-fix; both are folded into `npm run lint` / `npm run lint:fix`. Config lives in `.stylelintrc.json` (`@stylistic/stylelint-plugin`, with `postcss-scss` for `.scss` and `postcss-html` for `.vue`).

This playbook covers the judgment-level concerns stylelint cannot check: token misuse, duplication, misplacement, dark mode gaps, and design-system drift.

## Topic Files

| If the spec or code involves... | Read this file |
|--------------------------------|----------------|
| Design tokens, CSS variables, hardcoded values, color/spacing/typography usage | [./tokens.md](./tokens.md) |
| Component scoping, style placement, shared vs scoped CSS, extraction thresholds | [./structure.md](./structure.md) |
| Dark mode support, theme adaptation, semantic token usage | [./dark-mode.md](./dark-mode.md) |
| Duplication, redundant styles, reinvented patterns, component library misuse | [./duplication.md](./duplication.md) |
| LTR/RTL support, logical properties, internationalization in styles | [./i18n.md](./i18n.md) |
| SCSS mixins, nesting depth, selector specificity, CSS layers | [./scss-patterns.md](./scss-patterns.md) |

## Instructions

The companion files contain **Established Convention**, **Examples**, **Anti-Patterns**, and **Known Drift** sections for each area. Read only the files relevant to your current task.

When reviewing:

1. Identify which topics are relevant to the spec or code under review
2. Read only the relevant companion files
3. Check the spec or code against each file's **Established Convention** and **Anti-Patterns** sections
4. When inconsistency is found, apply the **Stylesheet Divergence Framework** below before flagging

## Stylesheet Divergence Framework

Not all style variation is a problem. Before flagging an inconsistency, check whether it meets one of these criteria:

### 1. Genuinely Unique Visual Context

The component has visual requirements that no existing pattern addresses. A calendar month grid has fundamentally different layout needs than a card list.

**Test:** "Does any existing component library class or mixin solve this? Would adapting one require forcing a square peg into a round hole?"

### 2. Different App with Different Design Goals

The `site/`, `client/`, and `widget/` apps intentionally have different visual identities or technical constraints. Styles in `site/` and `widget/` components don't need to match `client/` conventions exactly.

**Test:** "Is the divergence because this is in a different app with different design goals or technical constraints?"

### 3. Third-Party Integration Override

The style overrides a third-party component (e.g., calendar library, rich text editor) that doesn't use Pavillion's token system.

**Test:** "Is this style targeting an element whose markup we don't control?"

### 4. Animation or Transition Requirement

Animations and transitions sometimes need hardcoded values for timing, transforms, or intermediate states that don't map to design tokens.

**Test:** "Is the hardcoded value a timing, transform, or intermediate animation state?"

### Using the Framework

1. **Identify the issue** -- what convention does the style diverge from?
2. **Check the four criteria** -- does any criterion apply?
3. **If yes** -- note the divergence but classify it as "justified" with the criterion
4. **If no** -- flag it as drift that should be corrected
5. **If uncertain** -- flag it as "potential drift, verify intent" and let the developer decide
