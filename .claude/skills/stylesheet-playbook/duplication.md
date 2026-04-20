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

Modal dialogs are provided by two canonical Vue components sharing the `useDialog` composable -- do **not** hand-roll overlays, backdrops, focus traps, or escape handling in a component's scoped styles.

- **`src/client/components/common/modal.vue`** (`<Modal>`) — form, confirmation, and small dialogs. Accepts a `size` prop (`'md' | 'lg' | 'xl'`).
- **`src/client/components/common/Sheet.vue`** (`<Sheet>`) — list pickers and content-heavy dialogs with mobile concerns (bottom-sheet on mobile, centered on desktop).

```scss
// BAD: custom modal/overlay/backdrop in a component's scoped styles
.my-dialog-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}
```

```vue
<!-- GOOD: use the canonical component -->
<script setup>
import Modal from '@/client/components/common/modal.vue';
</script>

<template>
  <Modal :title="t('confirm.title')" size="md" @close="onClose">
    <p>{{ t('confirm.message') }}</p>
  </Modal>
</template>
```

See `src/client/components/common/confirm-delete-dialog.vue` for the canonical consumer pattern. For detailed modal/dialog accessibility and selection guidance, consult the `frontend-modals` skill.

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
