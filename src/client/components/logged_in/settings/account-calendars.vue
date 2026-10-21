<script setup lang="ts">
/**
 * Account settings leaf: every calendar the account owns or edits, owned
 * first, the order the calendar switcher uses. The settings layout supplies
 * the page heading, its help button and the column.
 *
 * - A calendar's name links to the first settings screen its viewer sees on
 *   it (General for an owner, Widget for an editor), computed by the same
 *   nav-items rule the tree and guards read, so the link never addresses an
 *   index that would land differently by viewport.
 * - An editor row has a Leave button that confirms in a dialog. Leaving drops
 *   the row and keeps the viewer here; focus moves to the link of the row
 *   that takes its place, or to the page heading when it was the last.
 *   An owner row has no action: an owner cannot leave their own calendar.
 * - Create a calendar opens the same create sheet the switcher uses, and the
 *   new calendar opens on its settings.
 */
import { computed, inject, nextTick, onMounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { CalendarPlus } from 'lucide-vue-next';
import type AuthenticationService from '@/client/service/authn';
import CalendarService from '@/client/service/calendar';
import { calendarDisplayName } from '@/client/service/calendar-display';
import { buildSettingsNavContext, readSettingsNavSources } from '@/client/service/settings-guards';
import { useCalendarStore } from '@/client/stores/calendarStore';
import type { CalendarInfo } from '@/common/model/calendar_info';
import type { Calendar } from '@/common/model/calendar';
import EmptyState from '@/client/components/common/empty_state.vue';
import LoadingMessage from '@/client/components/common/loading_message.vue';
import CreateCalendarSheet from '@/client/components/logged_in/calendar/create-calendar-sheet.vue';
import LeaveCalendarDialog from './leave-calendar-dialog.vue';
import { firstVisibleLeaf, SETTINGS_GROUP_INDEX_ROUTES } from './nav-items';
import { focusSettingsHeading } from './heading-focus';

const authn = inject('authn') as AuthenticationService;
const { t } = useTranslation('calendars', { keyPrefix: 'account_list' });
const store = useCalendarStore();

const loadFailed = ref(false);
const createOpen = ref(false);
const createTrigger = ref<HTMLElement | null>(null);
/** The calendar whose Leave confirmation is open, and its row's index. */
const leaving = ref<{ calendar: Calendar; index: number } | null>(null);
const listEl = ref<HTMLUListElement | null>(null);

const rows = computed<CalendarInfo[]>(() => [...store.ownedCalendars, ...store.editedCalendars]);

const navSources = computed(() => readSettingsNavSources(() => authn.isAdmin()));

/** The first settings screen the viewer sees on this calendar. */
function settingsTarget(info: CalendarInfo) {
  const ctx = buildSettingsNavContext('calendar', info.calendar.urlName, navSources.value);
  return ctx
    ? firstVisibleLeaf('calendar', ctx)
    : { name: SETTINGS_GROUP_INDEX_ROUTES.calendar, params: { calendar: info.calendar.urlName } };
}

onMounted(async () => {
  try {
    await new CalendarService().ensureCalendarsLoaded();
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    loadFailed.value = !store.loaded;
  }
});

function openCreate(event: MouseEvent) {
  createTrigger.value = event.currentTarget as HTMLElement | null;
  createOpen.value = true;
}

async function closeCreate() {
  createOpen.value = false;
  await nextTick();
  createTrigger.value?.focus();
}

function openLeave(info: CalendarInfo, index: number) {
  leaving.value = { calendar: info.calendar, index };
}

/**
 * The left calendar's row is already gone (the service dropped it from the
 * store), so the row now at its index is the one that took its place.
 */
async function onLeft() {
  const index = leaving.value?.index ?? 0;
  leaving.value = null;
  await nextTick();
  const next = listEl.value?.querySelectorAll<HTMLElement>('.account-calendars__name')[index];
  if (next) {
    next.focus();
  }
  else {
    focusSettingsHeading();
  }
}
</script>

<template>
  <div class="account-calendars">
    <p v-if="loadFailed" class="alert alert--error" role="alert">{{ t('error_loading') }}</p>

    <LoadingMessage v-else-if="!store.loaded" :description="t('loading')" />

    <EmptyState
      v-else-if="rows.length === 0"
      :title="t('empty_title')"
      :description="t('empty_description')"
    >
      <button
        type="button"
        class="btn btn--cta"
        aria-haspopup="dialog"
        data-testid="account-calendars-create"
        @click="openCreate"
      >
        <CalendarPlus :size="18" aria-hidden="true" />
        {{ t('create_calendar_button') }}
      </button>
    </EmptyState>

    <template v-else>
      <ul ref="listEl" class="account-settings-card account-calendars__list" role="list">
        <li
          v-for="(info, index) in rows"
          :key="info.calendar.id"
          class="account-calendars__row"
          data-testid="account-calendar-row"
          :data-url-name="info.calendar.urlName"
        >
          <div class="account-calendars__info">
            <RouterLink :to="settingsTarget(info)" class="account-calendars__name">
              {{ calendarDisplayName(info.calendar) }}
            </RouterLink>
            <span class="account-calendars__role">
              {{ info.isOwner ? t('owner_badge') : t('editor_badge') }}
            </span>
          </div>
          <button
            v-if="!info.isOwner"
            type="button"
            class="btn btn--ghost btn--sm account-calendars__leave"
            aria-haspopup="dialog"
            :aria-label="t('leave_button_aria', { calendar: calendarDisplayName(info.calendar) })"
            @click="openLeave(info, index)"
          >
            {{ t('leave_button') }}
          </button>
        </li>
      </ul>

      <div class="account-calendars__actions">
        <button
          type="button"
          class="btn btn--cta"
          aria-haspopup="dialog"
          data-testid="account-calendars-create"
          @click="openCreate"
        >
          <CalendarPlus :size="18" aria-hidden="true" />
          {{ t('create_calendar_button') }}
        </button>
      </div>
    </template>

    <LeaveCalendarDialog
      v-if="leaving"
      :calendar="leaving.calendar"
      @close="leaving = null"
      @left="onLeft"
    />

    <CreateCalendarSheet
      v-if="createOpen"
      :route-name="SETTINGS_GROUP_INDEX_ROUTES.calendar"
      @close="closeCreate"
    />
  </div>
</template>

<style scoped lang="scss">
.account-calendars {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-4);

  &__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: var(--pav-space-3);
    padding: var(--pav-space-4) var(--pav-space-6);

    & + & {
      border-block-start: var(--pav-border-width-1) solid var(--pav-border-subtle);
    }
  }

  &__info {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--pav-space-1);
    min-width: 0;
  }

  &__name {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-text-primary);
    text-decoration: underline;
    text-decoration-color: var(--pav-border-secondary);
    text-underline-offset: 0.2em;
    border-radius: var(--pav-border-radius-sm);

    &:hover {
      text-decoration-color: currentcolor;
    }

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: 2px;
    }
  }

  &__role {
    font-size: var(--pav-font-size-sm);
    color: var(--pav-text-secondary);
  }

  &__leave {
    flex-shrink: 0;
  }

  &__actions {
    display: flex;
  }
}
</style>
