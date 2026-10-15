<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { CalendarPlus } from 'lucide-vue-next';
import Sheet from '@/client/components/common/sheet.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';
import type { CalendarInfo } from '@/common/model/calendar_info';

const props = defineProps<{
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
const router = useRouter();
const store = useCalendarStore();

const rows = computed<CalendarInfo[]>(() => [...store.ownedCalendars, ...store.editedCalendars]);

const nameOf = (info: CalendarInfo) => info.calendar.content('en').name || info.calendar.urlName;

async function pick(info: CalendarInfo) {
  emit('close');
  await router.push({ name: props.routeName, params: { calendar: info.calendar.urlName } });
}
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
        <span v-if="info.calendar.urlName === currentUrlName" class="calendar-switcher-sheet__name">
          {{ nameOf(info) }}
          <span class="sr-only">{{ t('current_label') }}</span>
        </span>
        <a
          v-else
          href="#"
          class="calendar-switcher-sheet__name"
          @click.prevent="pick(info)"
        >
          {{ nameOf(info) }}
        </a>
        <span v-if="info.isEditor" class="calendar-switcher-sheet__badge">{{ t('editor_badge') }}</span>
      </li>
      <li class="calendar-switcher-sheet__row calendar-switcher-sheet__row--action">
        <button
          type="button"
          class="calendar-switcher-sheet__create"
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--pav-space-3);
    padding: var(--pav-space-3) var(--pav-space-4);
    border-radius: var(--pav-border-radius-md);

    &[aria-current='true'] {
      background: var(--pav-surface-secondary);
      font-weight: var(--pav-font-weight-medium);
    }

    &--action {
      border-block-start: var(--pav-border-width-1) solid var(--pav-border-subtle);
      margin-block-start: var(--pav-space-2);
      padding-block-start: var(--pav-space-4);
    }
  }

  &__name {
    flex: 1;
    color: var(--pav-text-primary);
    text-decoration: none;
  }

  a.calendar-switcher-sheet__name {
    &:hover {
      text-decoration: underline;
    }

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: 2px;
    }
  }

  &__badge {
    font-size: var(--pav-font-size-xs);
    color: var(--pav-text-secondary);
  }

  &__create {
    display: inline-flex;
    align-items: center;
    gap: var(--pav-space-2);
    background: none;
    border: 0;
    padding: 0;
    color: var(--pav-color-interactive-primary);
    cursor: pointer;
    font: inherit;

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: 2px;
    }
  }
}
</style>
