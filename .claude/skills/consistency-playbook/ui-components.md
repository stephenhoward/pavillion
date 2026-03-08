# UI Component Consistency

> Version: 1.0.0
> Last Updated: 2026-02-21

Conventions for Vue 3 components, Pinia stores, composables, and frontend service classes.

## Component File Structure

### Established Convention

```vue
<script setup>
// 1. Vue composition API
import { onBeforeMount, reactive, ref, watch, computed, inject } from 'vue';

// 2. Vue Router
import { useRoute, useRouter } from 'vue-router';

// 3. i18n
import { useTranslation } from 'i18next-vue';

// 4. External libraries
import { DateTime } from 'luxon';
import { Calendar, MapPin } from 'lucide-vue-next';

// 5. Stores
import { useEventStore } from '@/client/stores/eventStore';
import { useCalendarStore } from '@/client/stores/calendarStore';

// 6. Services
import CalendarService from '@/client/service/calendar';
import EventService from '@/client/service/event';

// 7. Components
import EventImage from '@/client/components/common/media/EventImage.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/PillButton.vue';

// 8. Composables
import { useBulkSelection } from '@/client/composables/useBulkSelection';
import { useToast } from '@/client/composables/useToast';

// --- Setup ---

// i18n initialization
const { t } = useTranslation('calendars', { keyPrefix: 'calendar' });

// Injections
const site_config = inject('site_config');

// Services and stores
const eventService = new EventService();
const calendarStore = useCalendarStore();

// Router
const route = useRoute();
const router = useRouter();

// Reactive state
const state = reactive({ err: '', calendar: null, isLoading: false });

// Computed properties
const calendarId = computed(() => route.params.calendar);

// Composables
const { selectedEvents, hasSelection, toggleEventSelection } = useBulkSelection();
</script>

<template>
  <!-- Template content -->
</template>

<style scoped lang="scss">
/* Component styles */
</style>
```

**Import order:** Vue core → Router → i18n → External libs → Stores → Services → Components → Composables

**Setup order:** i18n → Injections → Services/Stores → Router → Reactive state → Computed → Composables

### Component Section Order

1. `<script setup>` — always first
2. `<template>` — second
3. `<style scoped lang="scss">` — last, always scoped

---

## Component File Naming

### Established Convention

Component files use **PascalCase** for shared/reusable components and **kebab-case** or **camelCase** for page-level or feature-specific components:

```
# Shared components — PascalCase
src/client/components/common/PillButton.vue
src/client/components/common/EmptyState.vue
src/client/components/common/ModalDialog.vue

# Feature components — mixed (see Known Drift)
src/client/components/logged_in/calendar/calendar.vue
src/client/components/logged_in/calendar/SearchFilter.vue
src/client/components/logged_in/calendar/BulkOperationsMenu.vue
src/client/components/logged_in/calendar/CategorySelectionDialog.vue
```

### Known Drift

**Convention going forward:** PascalCase for all new components. Existing lowercase files don't need to be renamed.

Current state: shared components already use PascalCase (`PillButton.vue`, `ModalDialog.vue`), newer feature components use PascalCase (`SearchFilter.vue`, `CategorySelectionDialog.vue`), but some older page-level components use lowercase (`calendar.vue`, `event.vue`).

---

## Props Definition

### Established Convention

```typescript
// Using runtime props (current majority of codebase)
const props = defineProps({
  title: String,
  modalClass: String,
  initiallyOpen: {
    type: Boolean,
    default: true,
  },
});

// Using TypeScript generics (newer pattern)
const props = defineProps<{
  title: string;
  modalClass?: string;
  initiallyOpen?: boolean;
}>();
```

### Known Drift (Pattern Evolution)

**Convention going forward:** Use TypeScript generics (`defineProps<{...}>()`) for new components. Older components using runtime declarations are acceptable as-is. This is a **justified divergence** (criterion 2: pattern evolution).

---

## Emit Definition

### Established Convention

```typescript
const emit = defineEmits(['close', 'save', 'open-event']);
```

Event names use kebab-case in templates and are descriptive of what happened.

---

## Multiple Translation Namespaces

### Established Convention

When a component needs translations from multiple namespaces:

```typescript
const { t } = useTranslation('calendars', { keyPrefix: 'calendar' });
const { t: tBulk } = useTranslation('calendars', { keyPrefix: 'bulk_operations' });
const { t: tReport } = useTranslation('system', { keyPrefix: 'report' });
```

**Key points:**
- Primary namespace uses `t`
- Additional namespaces use destructured aliases: `t: tBulk`, `t: tReport`
- Alias naming matches the keyPrefix for clarity

---

## Pinia Store Conventions

### Established Convention

```typescript
// src/client/stores/{resource}Store.ts

import { defineStore } from 'pinia';
import { Calendar } from '@/common/model/calendar';

export const useCalendarStore = defineStore('calendars', {
  state: () => {
    return {
      calendars: [] as Calendar[],
      loaded: false,
      selectedCalendarId: null as string | null,
    };
  },

  getters: {
    hasCalendars: (state) => state.calendars.length > 0,

    getCalendarById: (state) => (id: string) => {
      return state.calendars.find((c: Calendar) => c.id === id) || null;
    },
  },

  actions: {
    setCalendars(calendars: Calendar[]) {
      this.calendars = calendars;
      this.loaded = true;
    },

    addCalendar(calendar: Calendar) {
      const exists = this.calendars.some((c: Calendar) => c.id === calendar.id);
      if (!exists) {
        this.calendars.push(calendar);
      }
    },

    updateCalendar(calendar: Calendar) {
      const index = this.calendars.findIndex((c: Calendar) => c.id === calendar.id);
      if (index >= 0) {
        this.calendars[index] = calendar;
      } else {
        this.addCalendar(calendar);
      }
    },

    removeCalendar(calendar: Calendar) {
      const index = this.calendars.findIndex((c: Calendar) => c.id === calendar.id);
      if (index >= 0) {
        this.calendars.splice(index, 1);
      }
    },
  },
});
```

**Key points:**
- File name: `{resource}Store.ts` (camelCase with `Store` suffix)
- Export: `export const use{Resource}Store = defineStore('{resources}', {...})`
- `state()` returns typed reactive data
- `getters` for derived/computed data — parameterized getters return functions
- `actions` for state mutations
- Standard CRUD action set: `set{Resources}`, `add{Resource}`, `update{Resource}`, `remove{Resource}`
- JSDoc comments on all public getters and actions
- Store data uses domain model instances (not plain objects)
- `update` actions use upsert pattern (update if exists, add if not)

---

## Frontend Service Pattern

### Established Convention

```typescript
// src/client/service/{resource}.ts

class CalendarService {
  async getCalendars(): Promise<Calendar[]> {
    const response = await fetch('/api/v1/calendars');
    const data = await response.json();
    return data.map((obj: Record<string, any>) => Calendar.fromObject(obj));
  }

  async createCalendar(urlName: string, name: string): Promise<Calendar> {
    const response = await fetch('/api/v1/calendars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urlName, name }),
    });
    const data = await response.json();
    return Calendar.fromObject(data);
  }
}
```

**Key points:**
- Services handle API communication and deserialization
- Response data is converted to domain models via `Model.fromObject()`
- Services return domain model instances, not raw API responses
- Components call services, then update stores with the returned models

---

## Known Drift

- **Store file naming**: Most stores use camelCase (`calendarStore.ts`, `eventStore.ts`, `categoryStore.ts`). This is consistent.
- **Service instantiation in components**: Services are instantiated directly in `<script setup>` (`const calendarService = new CalendarService()`). Some components share a service instance via injection. The direct instantiation pattern is simpler and preferred.
- **Composable vs inline logic**: Newer features extract reusable logic into composables (`useBulkSelection`, `useToast`). Older components have similar logic inline. Both are acceptable, but composables are preferred when logic is reused across 2+ components.
