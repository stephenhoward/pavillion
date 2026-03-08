## UI accessibility best practices

- **Semantic HTML**: Use appropriate HTML elements (nav, main, button, etc.) that convey meaning to assistive technologies
- **Keyboard Navigation**: Ensure all interactive elements are accessible via keyboard with visible focus indicators
- **Color Contrast**: Maintain sufficient contrast ratios (4.5:1 for normal text) and don't rely solely on color to convey information
- **Alternative Text**: Provide descriptive alt text for images and meaningful labels for all form inputs
- **Screen Reader Testing**: Test and verify that all views are accessible on screen reading devices.
- **ARIA When Needed**: Use ARIA attributes to enhance complex components when semantic HTML isn't sufficient
- **Logical Heading Structure**: Use heading levels (h1-h6) in proper order to create a clear document outline
- **Focus Management**: Manage focus appropriately in dynamic content, modals, and single-page applications

## Screen Reader Only Content

Use the `sr-only` mixin for content that should be read by screen readers but hidden visually.

```scss
// In mixins.scss - define once
@mixin sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Usage

```vue
<label for="search" class="sr-only">Search events</label>
<input id="search" type="text" placeholder="Search..." />
```

```scss
.sr-only {
  @include sr-only;
}
```

### When to use

- Labels for inputs that have visible placeholders
- Additional context for icon-only buttons (use `aria-label` instead when possible)
- Skip links that appear only on focus

## Toggle Switch Components

Use `role="switch"` with `aria-checked` for binary toggle controls.

```vue
<button
  type="button"
  role="switch"
  :aria-checked="modelValue"
  :aria-disabled="disabled"
  :disabled="disabled"
  @click="toggle"
  @keydown="handleKeydown"
>
  <span class="toggle-slider" />
</button>
```

### Required attributes

- `role="switch"` — identifies as toggle to screen readers
- `aria-checked` — must reflect current state (`true`/`false`)
- `aria-disabled` — mirror the `disabled` prop for screen readers

### Keyboard support

- **Space/Enter** — toggle the switch
- Focus must be visible (use `:focus` outline)

### Label association

Always associate with a label using `for`/`id`:

```vue
<label :for="id">{{ label }}</label>
<button :id="id" role="switch" ...>
```

## Expandable Controls

Use `aria-expanded` on buttons/triggers that show/hide content.

```vue
<button
  type="button"
  :aria-expanded="isOpen"
  :aria-label="t('filter_by_date')"
  @click="toggle"
>
  <span>{{ buttonText }}</span>
  <svg aria-hidden="true">...</svg>
</button>

<div v-if="isOpen" class="dropdown">
  <!-- expanded content -->
</div>
```

### Required attributes

- `aria-expanded` — must reflect open state (`true`/`false`)
- `aria-label` — provide context if button text isn't descriptive

### When to add `aria-controls`

- **Simple toggles** — `aria-expanded` alone is sufficient
- **Complex accordions/tabs** — add `aria-controls="region-id"` to link button to controlled region

### Decorative icons

Mark dropdown chevrons and icons as `aria-hidden="true"`:

```vue
<svg aria-hidden="true" class="dropdown-icon">...</svg>
```

## Form Labeling

Every form input must have an accessible name. Choose the approach based on UI design.

### Visible labels (preferred)

Use when there's space for visible text:

```vue
<div class="form-group">
  <label for="event-name">Event Name</label>
  <input id="event-name" type="text" v-model="name" />
</div>
```

### Hidden labels with sr-only

Use when placeholder provides visual context but input needs accessible name:

```vue
<label for="search" class="sr-only">Search events</label>
<input id="search" type="text" placeholder="Search..." />
```

### aria-label

Use for inputs where context is clear visually (e.g., icon buttons, inline inputs):

```vue
<input type="date" :aria-label="t('start_date')" />
<button :aria-label="t('clear_search')">✕</button>
```

### Error states

Use `role="alert"` and `aria-live="polite"` for error messages:

```vue
<div v-if="error" class="error" role="alert" aria-live="polite">
  {{ error }}
</div>
```

### Required fields

- Add `required` attribute for native validation
- Consider visual indicator (e.g., asterisk or border) for sighted users
