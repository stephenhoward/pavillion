# CSS Standards

> Last Updated: 2026-02-07
> Scope: Pavillion frontend styling

## Philosophy

**CSS-first with semantic classes.** Design tokens power everything, semantic classes describe purpose (not appearance), and the design system handles the heavy lifting.

## Decision Tree

Before writing any CSS, follow this decision tree:

### 1. Does this pattern already exist?

Check `src/client/assets/style/components/` first. Search for: buttons, modals, forms, cards, layouts.

- **If yes**: Use existing classes, don't reinvent
- **If no**: Continue to step 2

### 2. Will this be used more than once?

- **If yes**: Create reusable component in `components/`
- **If no**: Write scoped component CSS using design tokens

### 3. Is this truly new and valuable?

- **If genuinely new**: Extract to component library
- **If minor variation**: Extend existing system with a modifier class

## Quick Reference

| Need | Use | Never |
|------|-----|-------|
| Buttons | `.btn`, `.btn--primary`, `.btn--danger` | Custom button CSS |
| Modals/Dialogs | `.modal__overlay`, `.modal__content` | Custom overlays |
| Spacing | `var(--pav-space-*)` tokens | Hardcoded px values |
| Colors | `var(--pav-color-*)`, `var(--pav-surface-*)` | Hex values |
| New patterns | Extract to `components/` if used 2+ times | One-off duplicates |

## Rule of Thumb

- **<10 lines CSS + used once** = Component-scoped with design tokens
- **>10 lines CSS OR used 2+ times** = Extract to component library
- **Existing pattern** = Use existing classes, don't duplicate

## Semantic Classes

### When to Use Which Class Type

| Class Type | When to Use | Examples |
|------------|-------------|----------|
| **Domain-specific** | Component represents a core domain concept | `.event-card`, `.calendar-header`, `.organizer-profile` |
| **Global semantic** | Generic UI pattern without domain meaning | `.btn`, `.card`, `.input`, `.modal` |

**The threshold:** If a user would name this component when describing the interface, use a domain-specific class. If it's just a UI pattern, use a global class.

### Markup Examples

```html
<!-- Good: semantic class for domain concept -->
<article class="event-card">
  <button class="btn btn--primary">Register</button>
</article>

<!-- Good: component-specific class when customization needed -->
<article class="event-card">
  <button class="event-card__register">Register</button>
</article>

<!-- Bad: utility classes describing appearance -->
<div class="bg-white p-4 rounded-lg shadow">
```

## Writing Component CSS

### Scoped Styles with Design Tokens

```vue
<style scoped lang="scss">
.event-card {
  background: var(--pav-surface-card);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  padding: var(--pav-space-6);

  header {
    margin-block-end: var(--pav-space-4);
  }
}
</style>
```

### Override Patterns

```scss
// Preferred: Override via descendant selector
article.event-card button.btn {
  // custom overrides here
}

// Rarely needed: Component-specific element class
.event-card__register {
  // only when descendant selector is impractical
}
```

## Dark Mode

Tokens automatically adapt via `data-theme` attribute. Use semantic tokens, not raw colors:

```scss
// Good: semantic token adapts to theme
.component {
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
}

// Bad: raw color requires manual dark mode handling
.component {
  background: #fff;
  color: #222;
}
```

Components don't need `@media (prefers-color-scheme: dark)` blocks when using semantic tokens.

## Internationalization

Use logical properties for LTR/RTL support:

```scss
// Good: logical properties
.component {
  margin-inline-start: var(--pav-space-4);
  padding-inline: var(--pav-space-2);
  text-align: start;
}

// Avoid: physical properties
.component {
  margin-left: var(--pav-space-4);
  text-align: left;
}
```

## CSS Layers

Place new components in `@layer components`. Never use `!important` - layers handle specificity.

```css
@layer reset, tokens, base, layout, components;
```

## SCSS Mixins

Use mixins inside semantic class definitions for layout and spacing. **Never use utility classes in HTML markup.**

```scss
.event-list {
  @include flex-column;
  @include gap-4;

  &__item {
    @include flex-between;
    @include p-4;
  }
}
```

Available in `src/client/assets/style/mixins/`:
- **Layout**: `flex`, `flex-column`, `flex-center`, `grid-cols($n)`
- **Spacing**: `m-{1-12}`, `p-{1-12}`, `gap-{1-12}`

## Token Categories

- **Colors**: `--pav-color-*`, `--pav-surface-*`, `--pav-text-*`
- **Spacing**: `--pav-space-*` (4px base scale)
- **Typography**: `--pav-font-size-*`, `--pav-font-weight-*`
- **Borders**: `--pav-border-radius-*`, `--pav-border-width-*`
- **Shadows**: `--pav-shadow-*`

## Before Coding, Search

1. `grep -r "similar-pattern" src/client/assets/style/components/`
2. Check `src/client/assets/style/README.md` for existing patterns
3. Look at similar components in the codebase

## Anti-Patterns

```scss
// Never: Hardcoded values, one-off styling
.my-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  padding: 20px;
  z-index: 1000;
}

// Never: Custom button variants
.my-button {
  background: #dc3545;
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
}
```

## Resources

- **Full Token Reference**: `src/client/assets/style/README.md`
- **Component Library**: `src/client/assets/style/components/`
- **SCSS Mixins**: `src/client/assets/style/mixins/`
