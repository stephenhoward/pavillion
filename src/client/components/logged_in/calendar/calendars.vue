<script setup lang="ts">
import { onBeforeMount, reactive, ref, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTranslation } from 'i18next-vue';
import CalendarService from '@/client/service/calendar';
import EmptyLayout from '@/client/components/common/empty_state.vue';
import PillButton from '@/client/components/common/pill-button.vue';
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
  calendars: [],
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

onBeforeMount(async () => {
  loadCalendars();
  state.isLoading = true;
});

// Load calendar data and handle routing
async function loadCalendars() {
  try {
    const calendars = await calendarService.loadCalendars();

    // If the route is /calendar/new, always show the creation form
    if (route.path === '/calendar/new') {
      state.showCreationForm = true;
      return;
    }

    // If there is only one calendar, redirect to it
    if (calendars.length === 1) {
      router.push({ path: '/calendar/' + calendars[0].urlName });
    }
    else {
      state.calendars = calendars;
    }
  }
  catch (error) {
    console.error('Error loading calendars:', error);
    state.err = 'Failed to load calendars';
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
          <h2>{{ t('my_calendars_header') }}</h2>
          <PillButton
            variant="primary"
            @click="openCreateSheet"
          >
            {{ t('create_new_calendar_button') }}
          </PillButton>
        </div>
        <ul role="list">
          <li v-for="calendar in state.calendars" :key="calendar.id" role="listitem">
            <RouterLink
              :to="`/calendar/${calendar.urlName}`"
              :aria-label="t('aria_view_calendar', { calendarName: calendar.content('en').name || calendar.urlName })">
              {{ calendar.content("en").name || calendar.urlName }}
            </RouterLink>
          </li>
        </ul>
      </section>
    </nav>
    <EmptyLayout v-else :title="t('create_first_calendar_header')">
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
  align-items: center;
  margin-block-end: var(--pav-space-md);
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

  ul {
    list-style: none;
    padding: 0;
    margin: 0;

    li {
      margin-bottom: var(--pav-space-sm);

      a {
        display: block;
        padding: var(--pav-space-sm) var(--pav-space-md);
        color: var(--pav-color-text-primary);
        text-decoration: none;
        border-radius: var(--pav-border-radius-md);
        transition: background-color 0.2s ease;

        &:hover, &:focus {
          background-color: var(--pav-color-surface-secondary);
          text-decoration: underline;
        }

        &:focus-visible {
          outline: var(--pav-border-width-2) solid var(--pav-border-color-focus);
          outline-offset: var(--pav-space-xs);
        }
      }
    }
  }
}

</style>
