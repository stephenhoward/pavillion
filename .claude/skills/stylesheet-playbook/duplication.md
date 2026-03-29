# Style Duplication

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for avoiding duplicated styles and reusing the component library.

## Established Convention

### Check Before Writing

Before writing any CSS, search for existing patterns:

1. Check `src/client/assets/style/components/` for existing component classes
2. Check similar components in the codebase for shared patterns
3. If a pattern exists, use it -- don't reinvent it

### Component Library Classes

These patterns are already defined and globally available:

| Pattern | Classes | Location |
|---------|---------|----------|
| Buttons | `.btn`, `.btn--primary`, `.btn--secondary`, `.btn--danger`, `.btn--ghost`, `.btn--small` | `components/_buttons.scss` |
| Cards | `.card`, `.card--elevated`, `.card__header`, `.card__content` | `components/_cards.scss` |
| Forms | `.input`, `.select`, `.textarea`, `.label` | `components/_forms.scss` |
| Modals | `.modal__overlay`, `.modal__content` | `components/_modals.scss` |
| Tables | Table styles | `components/_tables.scss` |
| Alerts | Alert styles | `components/_alerts.scss` |
| Navigation | Nav styles | `components/_navigation.scss` |

### SCSS Mixins

Layout and spacing mixins are available globally:

| Category | Examples |
|----------|---------|
| Layout | `@include flex`, `@include flex-column`, `@include flex-center`, `@include flex-between`, `@include grid-cols(3)` |
| Spacing | `@include m-4`, `@include p-6`, `@include gap-4` |

Use mixins inside semantic class definitions, never as utility classes in markup.

## Anti-Patterns

### Reinventing Buttons

```scss
// BAD: custom button styles when .btn exists
.my-custom-button {
  background: var(--pav-color-brand-primary);
  color: white;
  padding: var(--pav-space-2) var(--pav-space-4);
  border-radius: var(--pav-border-radius-md);
  cursor: pointer;
}

// GOOD: use existing button class
// <button class="btn btn--primary">Action</button>
```

### Reinventing Modals

```scss
// BAD: custom modal/overlay when .modal__overlay exists
.my-dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}

// GOOD: use existing modal classes
// <div class="modal__overlay"><div class="modal__content">...</div></div>
```

### Duplicated Card Patterns

```scss
// BAD: same card pattern in multiple components
// event-list.vue:
.event-item {
  background: var(--pav-surface-card);
  padding: var(--pav-space-4);
  border-radius: var(--pav-border-radius-md);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
}
// calendar-list.vue:
.calendar-item {
  background: var(--pav-surface-card);
  padding: var(--pav-space-4);
  border-radius: var(--pav-border-radius-md);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
}

// GOOD: use .card class or extract shared pattern
```

### Duplicated Layout Patterns

```scss
// BAD: manually writing flex patterns
.my-list {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);
}

// GOOD: use mixin
.my-list {
  @include flex-column;
  @include gap-4;
}
```

## Known Drift

- Some components predate the component library and have inline implementations of patterns like buttons and cards
- The site app may duplicate some patterns from the client app's component library
- Older components may not use SCSS mixins for layout patterns
