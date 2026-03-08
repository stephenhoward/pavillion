# Modal/Dialog Accessibility

Use native `<dialog>` element for modals. It provides built-in focus trapping, escape handling, and screen reader support with less custom code.

## Required ARIA attributes

```vue
<dialog
  :aria-labelledby="titleId"
  :aria-modal="true"
  @keydown.esc="close"
>
  <h2 :id="titleId">{{ title }}</h2>
  <button aria-label="Close dialog">&times;</button>
</dialog>
```

## Rules

- Always link dialog to title with `aria-labelledby`
- Use `showModal()` not `show()` — ensures modal behavior
- Close button needs `aria-label` when using icon/symbol
- Add `body.modal-open` class to prevent background scroll
- Handle escape key to close
