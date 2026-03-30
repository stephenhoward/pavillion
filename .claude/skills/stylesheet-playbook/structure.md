# Style Placement and Scoping

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for where styles live, when to scope vs extract, and how to organize CSS.

## Established Convention

### Where Styles Belong

| Style Type | Location | When |
|------------|----------|------|
| Component-specific | `<style scoped lang="scss">` in `.vue` file | Used once, <10 lines |
| Shared component patterns | `src/client/assets/style/components/` | Used 2+ times OR >10 lines |
| Layout patterns | `src/client/assets/style/layout/` | Page-level layout containers |
| Design tokens | `src/client/assets/style/tokens/` | New token values |
| Theme mappings | `src/client/assets/style/themes/` | Light/dark token assignments |
| SCSS mixins | `src/client/assets/style/mixins/` | Reusable layout/spacing shortcuts |

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

### Adding to Component Library

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

### Importing Shared Styles Incorrectly

```scss
// BAD: @use or @import of shared style files in component scoped blocks
// (shared styles are globally available via main.scss)
@use '../../assets/style/components/buttons';
```

## Known Drift

- Some components have large scoped style blocks (30+ lines) that could be extracted
- A few components duplicate patterns that exist in the component library
- The site app has its own style organization that partially overlaps with client styles
