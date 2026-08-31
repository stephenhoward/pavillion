# Modal/Dialog Accessibility

Pavillion ships two canonical dialog components, both built on the native `<dialog>` element via a shared `useDialog` composable. The native element provides built-in focus trapping, escape handling, backdrop rendering, and screen-reader support with far less custom code than hand-rolled overlays.

Do **not** hand-roll modal overlays, backdrops, focus traps, or escape handlers. Use one of the canonical components below.

## Canonical Components

Both components live in `src/client/components/common/` and share `src/client/composables/useDialog.ts`.

### `<Modal>` — `modal.vue`

Form, confirmation, and small dialogs. Centered on desktop with a size-aware max-width; full-screen backdrop on mobile.

**Props:**

- `title?: string` — rendered in the dialog header, linked via `aria-labelledby`.
- `size?: 'md' | 'lg' | 'xl'` (default `'md'`) — desktop max-width.
  - `'md'` ~32rem — most dialogs, confirmations
  - `'lg'` ~40rem — forms (e.g. create-report, blocked-instances/reporters)
  - `'xl'` ~56rem — content-dense review dialogs (e.g. report-detail)
- `initiallyOpen?: boolean` (default `true`) — opens on mount; aligns with the v-if conditional-render pattern used throughout the app.
- `modalClass?: string` — optional extra class on the dialog element.

**Events:**

- `close` — emitted when the dialog closes (escape key, backdrop click, or `close` button).

### `<Sheet>` — `Sheet.vue`

List pickers and content-heavy dialogs with mobile concerns. Renders as a bottom-sheet on mobile (rounded top corners, flush to viewport bottom) and recenters as a standard modal on desktop (≥768px).

**Props:**

- `title: string` — required; rendered in the sheet header, linked via `aria-labelledby`.

**Events:**

- `close` — emitted when the sheet closes.

## Selection Heuristic

| Use `<Modal>` when... | Use `<Sheet>` when... |
|-----------------------|-----------------------|
| The dialog is a form, confirmation, or small prompt | The dialog is a list picker (languages, categories, timezones, etc.) |
| Content fits comfortably at `'md'`/`'lg'`/`'xl'` desktop widths | Content benefits from a bottom-sheet affordance on mobile |
| Mobile presentation as a centered modal is acceptable | Mobile presentation as a full-height bottom-sheet is preferred |

When in doubt, start with `<Modal size="md">`. Reach for `<Sheet>` only when the mobile-picker UX is the deciding factor.

## Usage Example

```vue
<script setup>
import Modal from '@/client/components/common/modal.vue';
import { useTranslation } from 'i18next-vue';

const { t } = useTranslation('system');
const emit = defineEmits(['close']);
</script>

<template>
  <Modal :title="t('confirm.delete.title')" size="md" @close="emit('close')">
    <p>{{ t('confirm.delete.message') }}</p>
    <footer>
      <button @click="emit('close')">{{ t('actions.cancel') }}</button>
      <button class="btn btn--danger" @click="onConfirm">{{ t('actions.delete') }}</button>
    </footer>
  </Modal>
</template>
```

See `src/client/components/common/confirm-delete-dialog.vue` for the canonical `<Modal>` consumer pattern.

## Required ARIA Wiring (inside the components)

Both canonical components already wire this up -- documented here for maintainers of `modal.vue`/`Sheet.vue`/`useDialog`:

```vue
<dialog
  role="dialog"
  :aria-labelledby="titleId"
  :aria-modal="true"
  @keydown.esc="close"
>
  <h2 :id="titleId">{{ title }}</h2>
  <button :aria-label="t('modal.close')">&times;</button>
</dialog>
```

## Rules

- Always use `<Modal>` or `<Sheet>` for dialogs -- never hand-roll overlays in scoped styles.
- Always link the dialog to its title with `aria-labelledby` (the components handle this via `useDialog`).
- Use `showModal()` not `show()` -- ensures modal behavior (the composable handles this).
- Close buttons with icon/symbol content need `aria-label` (the components provide this).
- Toggle `body.modal-open` while the dialog is open to prevent background scroll (the composable handles this).
- Handle escape key to close (bound in the components).
