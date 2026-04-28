---
name: Audit CSS Overhead
description: Detect unnecessary CSS pattern overhead in Pavillion frontend stylesheets — BEM-block aliasing of shared mixins, domain-named primitives, inline pattern duplication across components, and hand-rolled re-implementations of existing utilities. Use this skill when auditing for CSS cleanup opportunities, evaluating whether to extract a shared mixin, or surveying SCSS files for naming ceremony and convention drift.
---

# Audit CSS Overhead

Scan the frontend stylesheets for patterns that produce naming ceremony or duplication without payoff. Use this when the user asks to "audit", "find unnecessary", "cut down on", "clean up", or "consolidate" CSS, mixins, BEM, or stylesheet patterns.

## When this skill applies

- "Are we duplicating the modal footer styling across components?"
- "Is `_some-feature.scss` actually a generic primitive?"
- "Find places where we should be using `vstack` instead of inlining flex column."
- "Survey the stylesheets for cleanup targets."
- After a refactor, to check whether the same smell exists elsewhere.

## The four smells

1. **BEM-block aliasing of shared mixins.** A component defines `.{block}` with element rules where each element is a one-line `@include` calling a shared mixin and adds nothing else. `<style scoped>` already isolates the component, so the BEM prefix adds no scoping value — just ceremony.

   *Justified exception:* the block describes a domain concept with real per-component visual code that doesn't belong in a mixin.

2. **Domain-named primitives.** A mixin or component file whose name implies a domain ("challenge-step", "funding-form", "moderation-card") but whose contents are generic — vstack, form-field, modal-actions, code-display, label-above-input. The domain-name fiction lets the same pattern get re-introduced elsewhere under a different name.

3. **Inline pattern duplication.** The same 3-5 line CSS block repeated in 3+ components without a shared name. Common shapes:
   - Modal action footer (top border, end-justified, gap)
   - Form field column (label + input vertical stack)
   - Small secondary label (sm font; medium weight; muted color)
   - Section heading + intro paragraph pair
   - Read-only mono input/code surface
   - Card-with-icon-and-title-and-description button

4. **Hand-rolled re-implementation of existing utilities.** Components inlining what `_stacks.scss`, `_forms.scss`, `_calendar-admin.scss`, or `_typography.scss` already provide. Specifically:
   - flex column with `--pav-space-*` gap → `vstack` + `stack--md/sm/xs`
   - flex row with wrap and gap → `hstack` + `stack--wrap`
   - hardcoded stone-scale colors where semantic tokens exist (e.g. `var(--pav-color-stone-700)` vs `var(--pav-text-secondary)`)
   - hand-rolled font-family mono surfaces vs `code-display`/`code-input`
   - end-justified, top-bordered button rows vs `modal-actions`

## How to run a sweep

### Step 1 — pre-filter candidates with the helper script

The skill ships with a deterministic candidate finder. Run it from the repo root:

```bash
.claude/skills/audit-css-overhead/find-css-overhead.sh [scope...]
```

`scope` is one or more paths. Defaults to `src/client` and `src/site`. Examples:

```bash
.claude/skills/audit-css-overhead/find-css-overhead.sh
.claude/skills/audit-css-overhead/find-css-overhead.sh src/client/components/admin
.claude/skills/audit-css-overhead/find-css-overhead.sh src/client/components/logged_in/calendar-management/import-sources
```

The script prints findings categorized by smell type with `file:line:line-content`. It is informational only (always exits 0) and does not modify code. Output is stable enough to paste directly into the agent prompt as a candidate list.

### Step 2 — dispatch a stylesheet auditor with the prompt template below

Pick the agent by scope:
- **Tight scope** (one feature directory, one component file plus siblings): use `stylesheet-auditor` for neighborhood-comparison severity calibration.
- **Broad scope** (whole frontend, an entire app): use `Explore` (general-purpose codebase search) for breadth.

Pass the script output as a candidate list inside the prompt. The agent's job is to judge each candidate (real smell vs justified) and propose canonical replacements — not to re-discover candidates from scratch.

### Step 3 — convert findings into beads

For each cleanup target:
- **XS/S** (1-3 files, no convention question): file directly as a refactor bead and execute.
- **M** (4-8 files, naming question, or new shared mixin needed): file as a refactor bead, brainstorm the canonical name first.
- **L** (9+ files or codebase-wide convention reconciliation): file as an epic; decompose into wave-sized beads around shared touch boundaries.

## Agent prompt template

Paste this into a `Task` call, filling in `[SCOPE]` and the candidate list from Step 1.

```
Audit Pavillion frontend stylesheets for unnecessary CSS pattern overhead.

Scope: [SCOPE]
Working directory: the Pavillion repo root (where this command was invoked)

I'm looking for four specific smells that produce naming ceremony or
duplication without payoff. For each, give a calibrated verdict (real smell
vs justified) — not every match is a problem.

1. BEM-block aliasing of shared mixins. Components that define a .{block}
   with element rules where each element is a one-line `@include` calling a
   shared mixin and adds nothing else. <style scoped> already isolates the
   component, so the BEM prefix adds no scoping value. Justified exception:
   the block name describes a domain concept with real per-component visual
   code that doesn't belong in a mixin.

2. Domain-named primitives. Mixin or component files whose name implies a
   domain but whose contents are generic — vstack, form-field, modal-actions,
   code-display, label-above-input. Read each mixin: if its body would make
   sense at a generic name, flag it.

3. Inline pattern duplication. The same 3-5 line CSS block repeated in 3+
   components without a shared name (modal action footer; form-field column;
   small secondary label; section heading + intro paragraph; read-only mono
   surface; card-with-icon-title-description button). For each shape, list
   every site with file:line, then propose either an existing shared
   mixin/class to reuse or a new one to extract.

4. Hand-rolled re-implementation of existing utilities. Components inlining
   what `_stacks.scss` (vstack/hstack/stack--*), `_forms.scss` (.form, .input,
   code-display, code-input), `_calendar-admin.scss` (admin-dialog-layout,
   modal-actions, admin-ghost-button), or `_typography.scss` already provide.

I have run the deterministic candidate finder. Pre-filtered candidates:

[PASTE find-css-overhead.sh OUTPUT HERE]

Method:
- Read the candidate sites plus the canonical libraries:
  src/client/assets/style/mixins/*.scss,
  src/client/assets/style/components/*.scss,
  src/client/assets/style/tokens/*.scss.
- For each candidate, judge: is this a real smell or justified per the
  Stylesheet Divergence Framework (see stylesheet-playbook skill)?
- For inline duplication candidates, count instances across the codebase
  before recommending extraction (3+ instances = extract; 2 = consider;
  1 = leave alone).

Output: a prioritized punch list. Each entry must include:
- Smell category (1-4 above)
- File paths + line numbers
- Canonical replacement (existing mixin/class) OR new shared name + home file
- Effort estimate: XS (1 file), S (2-3 files), M (4-8 files), L (9+)
- Whether the cleanup is safe to do solo or needs broader convention agreement

Do NOT modify any code — read-only survey. Cap report at 800 words; if more
cleanup exists, list categories without exhausting every site.
```

## Cross-references

- `stylesheet-playbook` skill — detailed conventions, the Stylesheet Divergence Framework for severity calibration, and topic-specific guidance (`duplication.md`, `structure.md`, `tokens.md`).
- `frontend-css` skill — project CSS standards.
- `complexity-playbook` skill — broader complexity/maintainability framing if cleanup targets cross into "scope creep" territory.

## Worked example (pv-tl8v, 2026-04-26)

The user noticed `src/client/components/logged_in/calendar-management/import-sources/DnsChallengeStep.vue` had 9 BEM-prefixed classes. Sweeping the file plus its sibling `RelMeChallengeStep.vue` and `VerifyOwnershipWizard.vue` revealed:
- All three components defined their own BEM block, each forwarding to the same `_challenge-step.scss` mixin library (smell 1).
- `_challenge-step.scss` was a domain-named alias for generic primitives (smell 2): vstack, form-field, modal-actions, code-display.
- `.modal-actions` shape was duplicated in 4 other modals under hand-rolled rules (smell 3).
- Widget admin's `.embed-code` was a hand-rolled mono surface (smell 4).

Outcome: deleted `_challenge-step.scss`; promoted `@mixin modal-actions` to `_calendar-admin.scss` and `@mixin code-display` + `@mixin code-input` to `_forms.scss`; refactored 3 components to drop BEM. Net −150 lines. The 4 modal-actions duplicates and the embed-code site were filed as a follow-up bead (pv-qda2) for a broader convention sweep.
