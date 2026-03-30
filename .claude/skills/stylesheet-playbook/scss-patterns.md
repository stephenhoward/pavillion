# SCSS Patterns

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for SCSS usage, nesting, specificity, and CSS layers in Pavillion.

## Established Convention

### Nesting Depth

Maximum 3 levels of SCSS nesting. Deeper nesting creates specificity problems and harder-to-override styles.

```scss
// GOOD: 2-3 levels
.event-card {
  header {
    h3 { ... }
  }
  &__actions {
    .btn { ... }
  }
}

// BAD: 4+ levels
.event-card {
  .content {
    .details {
      .meta {
        span { ... }  // too deep
      }
    }
  }
}
```

### BEM Naming

Use BEM convention for component classes:

- **Block:** `.event-card`
- **Element:** `.event-card__header`
- **Modifier:** `.event-card--featured`

```scss
.event-card {
  &--featured { ... }
  &__header { ... }
  &__actions { ... }
}
```

### CSS Layers

New component styles go in `@layer components`. Never use `!important`.

```scss
// In main.scss
@layer reset, tokens, base, layout, components;

@layer components {
  @import './components/my-component';
}
```

### Mixin Usage

Use SCSS mixins inside semantic class definitions for layout and spacing. Never use utility classes directly in HTML markup.

```scss
// GOOD: mixins inside semantic classes
.event-list {
  @include flex-column;
  @include gap-4;
}

// BAD: utility classes in HTML
// <div class="flex flex-column gap-4">
```

### Selector Specificity

Prefer low-specificity selectors. Use class selectors over element selectors when possible. Avoid ID selectors for styling.

```scss
// GOOD: class selector
.event-title { font-size: var(--pav-font-size-lg); }

// ACCEPTABLE: element selector in component context
.event-card {
  header { ... }
  h3 { ... }
}

// BAD: ID selector for styling
#event-title { font-size: var(--pav-font-size-lg); }

// BAD: !important
.event-title { font-size: var(--pav-font-size-lg) !important; }
```

### Override Patterns

When a component needs to override a global class:

```scss
// Preferred: descendant selector with component context
.event-card .btn {
  // overrides specific to this component
}

// Also acceptable: BEM element class
.event-card__register {
  // component-specific element
}
```

## Anti-Patterns

### Deep Nesting

```scss
// BAD: 4+ levels creates specificity war
.page {
  .content {
    .sidebar {
      .widget {
        .title { ... }
      }
    }
  }
}
```

### !important

```scss
// BAD: !important breaks the cascade
.my-component {
  color: var(--pav-text-primary) !important;
}
```

### Overly Specific Selectors

```scss
// BAD: unnecessarily specific
div.event-card > header > h3.event-card__title { ... }

// GOOD: minimal specificity
.event-card__title { ... }
```

### Utility Classes in Markup

```html
<!-- BAD: Tailwind-style utility classes -->
<div class="flex flex-col gap-4 p-6 bg-white rounded-lg">

<!-- GOOD: semantic class -->
<div class="event-card">
```

## Known Drift

- Some components may have deeper nesting than 3 levels
- Older components may not follow BEM naming
- Some components may use `!important` as a workaround
