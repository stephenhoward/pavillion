<script setup lang="ts">
import { onBeforeMount, reactive, ref, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import { Calendar, ChevronRight, Crown, ExternalLink } from 'lucide-vue-next';
import CalendarService from '@/client/service/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import HelpButton from '@/client/components/common/help-button.vue';
import CreateCalendarForm from './CreateCalendarForm.vue';
import CreateCalendarSheet from './CreateCalendarSheet.vue';

const calendarService = new CalendarService();

const { t } = useTranslation('calendars', {
  keyPrefix: 'list',
});

const router = useRouter();
const route = useRoute();
const state = reactive({
  err: '',
  calendars: [] as CalendarInfo[],
  isLoading: false,
  showCreationForm: false,
});

const showCreateSheet = ref(false);
const createSheetTriggerEl = ref<HTMLElement | null>(null);

function openCreateSheet(event: MouseEvent) {
  createSheetTriggerEl.value = (event?.currentTarget as HTMLElement) ?? null;
  showCreateSheet.value = true;
}

async function closeCreateSheet() {
  showCreateSheet.value = false;
  await nextTick();
  createSheetTriggerEl.value?.focus();
}

/**
 * Returns the display description for a calendar card.
 * Falls back to /urlName when no description is available.
 */
function getDescription(info: CalendarInfo): string {
  const desc = info.calendar.content('en').description;
  return desc || `/${info.calendar.urlName}`;
}

onBeforeMount(async () => {
  loadCalendars();
  state.isLoading = true;
});

// Load calendar data and handle routing
async function loadCalendars() {
  try {
    const calendarInfos = await calendarService.loadCalendarsWithRelationship();

    // If the route is /calendar/new, always show the creation form
    if (route.path === '/calendar/new') {
      state.showCreationForm = true;
      return;
    }

    // If there is only one calendar, redirect to it
    if (calendarInfos.length === 1) {
      router.push({ path: '/calendar/' + calendarInfos[0].calendar.urlName });
    }
    else {
      state.calendars = calendarInfos;
    }
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.err = t('error_loading_calendars');
  }
  finally {
    state.isLoading = false;
  }
}
</script>

<template>
  <main role="main" :aria-label="t('aria_calendar_management')">
    <nav v-if="state.calendars.length > 0 && !state.showCreationForm" :aria-label="t('aria_my_calendars_navigation')">
      <section>
        <div class="calendars-header">
          <div class="calendars-header__text">
            <h2>{{ t('my_calendars_header') }}</h2>
            <p class="calendars-header__count">
              {{ t('calendar_count', { count: state.calendars.length }) }}
            </p>
          </div>
          <div class="calendars-header__actions">
            <HelpButton />
            <PillButton
              variant="primary"
              @click="openCreateSheet"
            >
              {{ t('create_new_calendar_button') }}
            </PillButton>
          </div>
        </div>
        <ul class="calendar-cards" role="list">
          <li
            v-for="info in state.calendars"
            :key="info.calendar.id"
            role="listitem"
          >
            <div class="calendar-card">
              <div class="calendar-card__icon">
                <Calendar :size="24" aria-hidden="true" />
              </div>

              <div class="calendar-card__body">
                <div class="calendar-card__title-row">
                  <span class="calendar-card__name">
                    {{ info.calendar.content('en').name || info.calendar.urlName }}
                  </span>

                  <span v-if="info.isOwner" class="calendar-card__badge calendar-card__badge--owner">
                    <Crown :size="12" aria-hidden="true" />
                    {{ t('role_owner') }}
                  </span>
                  <span v-else class="calendar-card__badge calendar-card__badge--editor">
                    {{ t('role_editor') }}
                  </span>

                  <a
                    :href="`/view/${info.calendar.urlName}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="calendar-card__public-link"
                    :aria-label="t('aria_view_public_calendar', { name: info.calendar.content('en').name || info.calendar.urlName })"
                  >
                    <ExternalLink :size="14" aria-hidden="true" />
                  </a>
                </div>

                <p class="calendar-card__description">
                  {{ getDescription(info) }}
                </p>
              </div>

              <div class="calendar-card__chevron">
                <ChevronRight :size="20" aria-hidden="true" />
              </div>

              <RouterLink
                :to="`/calendar/${info.calendar.urlName}`"
                class="calendar-card__link"
                :aria-label="t('aria_navigate_calendar', {
                  calendarName: info.calendar.content('en').name || info.calendar.urlName,
                  role: info.isOwner ? t('role_owner') : t('role_editor'),
                })"
              />
            </div>
          </li>
        </ul>
      </section>
    </nav>
    <EmptyLayout
      v-else
      :title="t('create_first_calendar_header')"
      :guide="{ slug: 'guides/calendar-owners/quickstart', key: 'quickstart' }"
    >
      <CreateCalendarForm />
    </EmptyLayout>

    <CreateCalendarSheet
      v-if="showCreateSheet"
      @close="closeCreateSheet"
    />
  </main>
</template>

<style scoped lang="scss">

.calendars-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-block-end: var(--pav-space-lg);

  &__text {
    display: flex;
    flex-direction: column;
    gap: var(--pav-space-xs);
  }

  &__count {
    font-size: var(--pav-font-size-body-small);
    color: var(--pav-color-text-secondary);
    margin: 0;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: var(--pav-space-2);
  }
}

/* Semantic nav styling */
nav {
  margin: var(--pav-space-lg) 0;

  section {
    padding: var(--pav-space-md);
  }

  h2 {
    font-size: var(--pav-font-size-heading-4);
    font-weight: var(--pav-font-weight-semibold);
    color: var(--pav-color-text-primary);
    margin: 0;
  }
}

.calendar-cards {
  display: flex;
  flex-direction: column;
  gap: var(--pav-space-sm);
  list-style: none;
  padding: 0;
  margin: 0;
}

.calendar-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--pav-space-md);
  padding: var(--pav-space-md) var(--pav-space-lg);
  background: var(--pav-color-surface-primary);
  border: var(--pav-border-width-1) solid var(--pav-color-border-primary);
  border-radius: var(--pav-border-radius-lg);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  cursor: pointer;

  &:hover,
  &:focus-within {
    border-color: var(--pav-color-accent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  &__link {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    z-index: 0;

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: var(--pav-space-xs);
    }
  }

  &__icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border-radius: var(--pav-border-radius-md);
    background: var(--pav-color-accent-light, rgba(249, 115, 22, 0.1));
    color: var(--pav-color-accent);
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__title-row {
    display: flex;
    align-items: center;
    gap: var(--pav-space-sm);
    flex-wrap: wrap;
    margin-block-end: var(--pav-space-xs);
  }

  &__name {
    font-size: var(--pav-font-size-body);
    font-weight: var(--pav-font-weight-medium);
    color: var(--pav-color-text-primary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.5rem;
    font-size: var(--pav-font-size-body-small);
    font-weight: var(--pav-font-weight-medium);
    border-radius: var(--pav-border-radius-full, 9999px);
    flex-shrink: 0;

    &--owner {
      background-color: rgba(245, 158, 11, 0.15);
      color: #b45309;
    }

    &--editor {
      background-color: var(--pav-color-surface-secondary);
      color: var(--pav-color-text-secondary);
    }
  }

  &__public-link {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--pav-color-text-tertiary, var(--pav-color-text-secondary));
    text-decoration: none;
    padding: 0.125rem;
    border-radius: var(--pav-border-radius-sm);

    &:hover,
    &:focus-visible {
      color: var(--pav-color-accent);
    }

    &:focus-visible {
      outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
      outline-offset: 2px;
    }
  }

  &__description {
    font-size: var(--pav-font-size-body-small);
    color: var(--pav-color-text-secondary);
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__chevron {
    flex-shrink: 0;
    color: var(--pav-color-text-tertiary, var(--pav-color-text-secondary));
    transition: color 0.2s ease;
  }

  &:hover &__chevron {
    color: var(--pav-color-accent);
  }
}

// Dark mode adjustments for owner badge
@media (prefers-color-scheme: dark) {
  .calendar-card__badge--owner {
    background-color: rgba(245, 158, 11, 0.2);
    color: #fbbf24;
  }
}

</style>
