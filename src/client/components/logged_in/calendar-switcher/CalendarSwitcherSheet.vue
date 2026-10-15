<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { CalendarPlus } from 'lucide-vue-next';
import Sheet from '@/client/components/common/sheet.vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import type { CalendarInfo } from '@/common/model/calendar_info';

defineProps<{
  /** Named route to navigate to with `{ calendar: urlName }` when a row is picked. */
  routeName: string;
  /** The calendar the host page already shows; its row is marked current and is inert. Null when the page shows none. */
  currentUrlName: string | null;
}>();

const emit = defineEmits<{
  close: [];
  create: [];
}>();

const { t } = useTranslation('calendars', { keyPrefix: 'switcher' });
const store = useCalendarStore();

const rows = computed<CalendarInfo[]>(() => [...store.ownedCalendars, ...store.editedCalendars]);

const nameOf = (info: CalendarInfo) => info.calendar.content('en').name || info.calendar.urlName;

// Revalidate on open: a no-op for the same account, while a different
// signed-in account resets and refetches, so the sheet never lists a
// previous account's calendars. A failed load keeps the list as it is.
onMounted(() => {
  new CalendarService().ensureCalendarsLoaded().catch((error) => {
    console.error('Error loading calendars:', error);
  });
});
</script>

<template>
  <Sheet :title="t('title')" @close="emit('close')">
    <p v-if="rows.length === 0" class="calendar-switcher-sheet__empty">{{ t('no_calendars') }}</p>
    <ul class="calendar-switcher-sheet__list" role="list">
      <li
        v-for="info in rows"
        :key="info.calendar.id"
        class="calendar-switcher-sheet__row"
        data-testid="switcher-row"
        :data-url-name="info.calendar.urlName"
        :aria-current="info.calendar.urlName === currentUrlName ? 'true' : undefined"
      >
        <span v-if="info.calendar.urlName === currentUrlName" class="calendar-switcher-sheet__target">
          <span class="calendar-switcher-sheet__name">
            {{ nameOf(info) }}
            <span class="sr-only">{{ t('current_label') }}</span>
          </span>
          <span v-if="info.isEditor" class="calendar-switcher-sheet__badge">{{ t('editor_badge') }}</span>
        </span>
        <RouterLink
          v-else
          :to="{ name: routeName, params: { calendar: info.calendar.urlName } }"
          class="calendar-switcher-sheet__target"
          @click="emit('close')"
        >
          <span class="calendar-switcher-sheet__name">{{ nameOf(info) }}</span>
          <span v-if="info.isEditor" class="calendar-switcher-sheet__badge">{{ t('editor_badge') }}</span>
        </RouterLink>
      </li>
      <li class="calendar-switcher-sheet__row calendar-switcher-sheet__row--action">
        <button
          type="button"
          class="btn btn--ghost calendar-switcher-sheet__create"
          data-testid="switcher-create"
          @click="emit('create')"
        >
          <CalendarPlus :size="16" aria-hidden="true" />
          {{ t('create_calendar_button') }}
        </button>
      </li>
      <slot />
    </ul>
  </Sheet>
</template>

<style scoped lang="scss">
.calendar-switcher-sheet {
  &__empty {
    margin: 0 0 var(--pav-space-3);
    color: var(--pav-text-secondary);
  }

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-1);
  }

  &__row {
    border-radius: var(--pav-border-radius-md);

    &[aria-current='true'] {
      background: var(--pav-surface-secondary);
      font-weight: var(--pav-font-weight-medium);
    }

    &--action {
      border-block-start: var(--pav-border-width-1) solid var(--pav-border-subtle);
      border-radius: 0;
      margin-block-start: var(--pav-space-2);
      padding-block-start: var(--pav-space-2);
    }
  }

  /* The link (or the current row's label) fills the row, so the whole padded
     row is the hit area. */
  &__target {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pav-space-3);
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: inherit;
    color: var(--pav-text-primary);
    text-decoration: none;
  }

  a.calendar-switcher-sheet__target {
    &:hover {
      background: var(--pav-interactive-hover);

      .calendar-switcher-sheet__name {
        text-decoration: underline;
      }
    }

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: -2px;
    }
  }

  &__name {
    flex: 1;
  }

  &__badge {
    font-size: var(--pav-font-size-xs);
    color: var(--pav-text-secondary);
  }

  &__create {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
