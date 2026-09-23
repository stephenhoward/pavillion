# Style Placement and Scoping

> Version: 1.1.0
> Last Updated: 2026-09-22

Conventions for where styles live, when to scope vs extract, and how to organize CSS.

## Established Convention

### Where Styles Belong

Which app a file belongs to decides where its styles live. The authenticated client and the public surface (site, widget, and the shared UI module they both consume) have separate styling systems, and a rule written for one is usually wrong for the other.

| Style Type | Location | Scope | When |
|------------|----------|-------|------|
| Component-specific | `<style scoped lang="scss">` in the `.vue` file | Any app | Used once, <10 lines |
| Shared public design system | `src/common/ui/assets/mixins.scss` | `src/common/ui`, `src/site`, `src/widget` | The `$public-*` tokens and `public-*` mixins — the only styling source a component under `src/common/ui/` may use |
| Script-side breakpoints | `src/common/ui/assets/breakpoints.ts` | `src/common/ui`, `src/site`, `src/widget` | A component must branch on viewport width in script rather than in a media query |
| Site app styles | `src/site/assets/style.scss` | `src/site` | Styling only the public site needs |
| Shared component patterns | `src/client/assets/style/components/` | `src/client` | Used 2+ times OR >10 lines |
| Layout patterns | `src/client/assets/style/layout/` | `src/client` | Page-level layout containers |
| Design tokens | `src/client/assets/style/tokens/` | `src/client` | New token values |
| Theme mappings | `src/client/assets/style/themes/` | `src/client` | Light/dark token assignments |
| SCSS mixins | `src/client/assets/style/mixins/` | `src/client` | Reusable layout/spacing shortcuts |

Notes on the shared rows:

- A component under `src/common/ui/` may not reach into `src/client/assets/style/**`. The boundary rule in `src/common/ui/README.md` forbids it and `src/common/ui/test/boundary.test.ts` enforces it.
- `src/common/ui/assets/breakpoints.ts` mirrors the `public-tablet-up` / `public-desktop-up` mixins. Sass and TypeScript cannot share one declaration, so `src/common/ui/test/breakpoints.test.ts` fails when the two drift apart. Change both together.
- `src/site/assets/mixins.scss` is now a one-line `@forward` shim onto the shared file, kept for existing call sites. New call sites use `@use '@/common/ui/assets/mixins'` directly.
- `mixins.scss` also carries unprefixed compatibility aliases (`filter-container`, `input-base`, `dark-mode`, the `$spacing-*` scale) for call sites that predate the `public-*` naming. Those are legacy surface, not the design system — do not reach for them in a new shared component.

### Extraction Threshold

- **<10 lines CSS + used once** = Component-scoped `<style scoped>`
- **>10 lines CSS OR used 2+ times** = Extract to `components/` library
- **Existing pattern** = Use existing classes, don't duplicate

### Vue Component Style Block

```vue
<style scoped lang="scss">
.my-component {
  /* component-specific styles using tokens */
}
</style>
```

Always use `scoped` and `lang="scss"`.

### Adding to Component Library (`src/client`)

1. Create `src/client/assets/style/components/_my-pattern.scss`
2. Import in `main.scss` inside `@layer components { }`
3. Use BEM naming: `.block`, `.block--modifier`, `.block__element`

## Anti-Patterns

### Styles in Wrong Location

```vue
<!-- BAD: Complex styles that should be in component library -->
<style scoped lang="scss">
.calendar-card {
  /* 40+ lines of CSS that are also duplicated in another component */
}
</style>
```

### Unscoped Styles

```vue
<!-- BAD: missing scoped attribute leaks styles globally -->
<style lang="scss">
.my-component { ... }
</style>
```

### Inline Styles

```vue
<!-- BAD: style attribute bypasses the design system -->
<div style="background: #fff; padding: 20px;">
```

### Duplicated Component Styles

```scss
// BAD: same card pattern written in 3 different components
// Component A:
.event-card { background: var(--pav-surface-card); padding: var(--pav-space-4); border-radius: var(--pav-border-radius-md); }
// Component B:
.calendar-card { background: var(--pav-surface-card); padding: var(--pav-space-4); border-radius: var(--pav-border-radius-md); }

// GOOD: extract to component library as .card with modifiers
```

### Importing Shared Styles Incorrectly (`src/client` only)

In the client app, shared styles are globally available via `main.scss`, so pulling them into a component's scoped block duplicates them:

```scss
// BAD, in a src/client component: shared styles already arrive via main.scss
@use '../../assets/style/components/buttons';
```

This is a client-app fact, not a general rule. The public surface has no equivalent global entry point, so a component under `src/common/ui/`, `src/site/`, or `src/widget/` reaches the shared design system by exactly the pattern above — that is the correct and only way to get at it:

```scss
// GOOD, in a shared or public component: this is how the design system arrives
@use '@/common/ui/assets/mixins' as *;
```

### ARIA Role Selectors Carrying Visual Payload

ARIA **role** selectors (e.g., `[role="dialog"]`, `[role="navigation"]`, `[role="alert"]`) must **not** carry visual, layout, positioning, or responsive payload. ARIA **state** attribute selectors (e.g., `[aria-expanded]`, `[aria-invalid]`, `[aria-current]`, `[aria-selected]`, `[aria-disabled]`) remain acceptable for CSS state representation — they communicate user-facing state that CSS legitimately needs to reflect.

The rationale: a role attribute identifies *what an element is* for assistive technology; it is not a skin. Attaching visual payload to a role selector collides with a11y-only role additions (e.g., adding `role="dialog"` to a container for screen-reader labeling should never silently import layout, backdrop, or positioning rules). State attributes are different — they describe *how an element currently behaves*, and CSS is the natural place to reflect that state.

```scss
// BAD: visual/layout payload keyed off a role identifier
[role="dialog"] {
  position: fixed;
  inset: 0;
  background: var(--pav-surface-primary);
  padding: var(--pav-space-xl);
}

[role="navigation"] {
  display: flex;
  gap: var(--pav-space-4);
}

// GOOD: keep role as a pure identity hook; put visuals on a semantic class
// (or use the canonical component, e.g. <Modal>/<Sheet> for dialogs)
.site-nav {
  display: flex;
  gap: var(--pav-space-4);
}

// GOOD: state attributes legitimately reflect user-facing state
.accordion-header[aria-expanded="true"] {
  background: var(--pav-interactive-hover);
}

.form-field[aria-invalid="true"] {
  border-color: var(--pav-color-danger);
}
```

## Known Drift

- Some components have large scoped style blocks (30+ lines) that could be extracted
- A few components duplicate patterns that exist in the component library
- The site's mixins have moved to `src/common/ui/assets/mixins.scss`, leaving `src/site/assets/mixins.scss` as a `@forward` shim that most existing site and widget call sites still go through. New call sites should use the shared path; the shim is retired once they all do.
- The client and public token systems remain separate: client components read a broad set of `--pav-*` custom properties, the public stylesheet declares only four of them. That is why a styled shared component cannot render in the client, and it is the open question on pv-z1in.
- `src/client/assets/style/` and `src/common/ui/assets/` are parallel systems with overlapping concerns (spacing scales, dark-mode handling) and no shared source.
