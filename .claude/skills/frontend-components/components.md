# Vue Component Standards

## File Naming

Use PascalCase for all component files:

```
✓ CategorySelector.vue
✓ EventImage.vue
✓ ToggleSwitch.vue
✗ category_selector.vue
✗ languagePicker.vue
```

## Component Locations

```
src/
├── common/components/       # Cross-app shared (client + site + widget)
│   ├── Modal.vue            # Pure UI, no app logic
│   └── EmptyState.vue
├── client/
│   └── components/
│       └── common/          # Client-app shared (reused within client)
│           ├── EventImage.vue   # Can have client-specific API calls
│           └── ToggleSwitch.vue
├── site/
│   └── components/
│       └── common/          # Site-app shared (reused within site)
│           └── EventImage.vue   # Site-specific behavior
└── widget/
    └── components/          # Widget-specific components
```

**Two levels of sharing:**

1. **Cross-app shared** (`common/components/`)
   - Used by multiple apps (client, site, widget)
   - Pure UI only — no API calls, no business logic
   - Example: Modal, EmptyState, basic form inputs

2. **App-specific shared** (`*/components/common/`)
   - Reused within one app only
   - Can include app-specific API calls and logic
   - Example: EventImage with client-specific polling

**App-specific variants that extend cross-app**: Import from common/, wrap with additional behavior:
```typescript
// client/components/media/EventImage.vue
import BaseEventImage from '@/common/components/EventImage.vue';
// Add polling logic, error handling specific to authenticated context
```

## Props & Events

Use TypeScript generics with `withDefaults()`:

```typescript
// ✓ Preferred
const props = withDefaults(defineProps<{
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
}>(), {
  size: 'medium',
  disabled: false,
});

// ✗ Avoid (unless complex runtime validation needed)
const props = defineProps({
  size: { type: String, default: 'medium' },
});
```

Typed emits:
```typescript
const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'close'): void;
}>();
```

## v-model Support

Form input components must implement v-model:

```typescript
const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

// Usage
<MyInput v-model="searchText" />
```

Non-form components may use custom events when v-model doesn't fit semantically.

## Accessibility Requirements

Cross-app shared components in `common/components/` must meet WCAG AA:

- **Keyboard navigation**: All interactive elements operable via Tab/Enter/Space/Arrow keys
- **ARIA labels**: Use `aria-label` or `aria-labelledby` on buttons, inputs, interactive elements
- **Focus management**: Visible focus indicators, focus trapping in modals
- **Screen reader support**: Use `sr-only` class for context text (see `accessibility.md`)

Component checklist before moving to common/:
- [ ] Can be operated entirely with keyboard
- [ ] Has appropriate ARIA attributes
- [ ] Focus indicator is visible
- [ ] Tested with screen reader (VoiceOver/NVDA)

See the `frontend-accessibility` skill for patterns.

## Reuse Before Build

### During Planning

Before building new UI, check **both** levels for existing components:

1. **Cross-app shared**: Search `common/components/` for generic UI patterns
2. **App-specific shared**: Search `client/components/common/` (or `site/`, `widget/`) for app reusables
3. **Feature components**: Check if a similar component exists that could be extended via props

Include "Identify reusable components" as a task in feature specs.

### When to Extract

**Extract to `common/components/`** (cross-app) when:
- Component is used by **multiple apps** (client + site, or all three)
- Component has **no app-specific logic** — pure UI only
- Example: Modal, ToggleSwitch, EmptyState

**Extract to `*/components/common/`** (app-specific shared) when:
- Component is used in **2+ places within one app**
- Component may have app-specific API calls or logic
- Example: EventImage with client-specific polling

**Keep as page/feature component** when:
- Used in only one place
- Highly coupled to specific page or feature context

### Avoid Duplication

Before creating a new component, ask:
- Does a similar component already exist?
- Can an existing component be extended via props?
- Can I compose existing components instead of building from scratch?

When in doubt, start with composition of existing components.
