<script setup lang="ts">
/**
 * Calendar management: the one gate in front of a calendar's settings index
 * and every calendar leaf beneath it.
 *
 * - Resolves the route's calendar once, from the viewer's own loaded list.
 *   The settings layout keys this pane by calendar, so switching calendars
 *   remounts it. No child mounts until the calendar has resolved.
 * - A leaf the viewer may not see (an owner-only leaf, for an editor) is
 *   replaced with the group's first visible leaf, query dropped, and never
 *   mounts. Visibility is nav-items.ts's; hiding a leaf is a convenience,
 *   and the server endpoints each leaf calls stay the enforcement point.
 * - A nonexistent calendar and one the viewer is not a member of are the
 *   same unresolved calendar: one empty state at the unchanged URL, for the
 *   index and every leaf, and nothing renders the route param.
 * - Leaves receive the calendar and ownership as props from the calendar
 *   store entry; nothing is provided or injected.
 */
import { computed, inject, onBeforeMount, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { useRoute, useRouter } from 'vue-router';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import Config from '@/client/service/config';
import { useCalendarStore } from '@/client/stores/calendarStore';
import {
  buildSettingsNavContext,
  findViewerCalendar,
  readSettingsNavSources,
} from '@/client/service/settings-guards';
import {
  findLeafByRouteName,
  firstVisibleLeaf,
  isVisibleLeaf,
  SETTINGS_GROUP_INDEX_ROUTES,
} from '@/client/components/logged_in/settings/nav-items';
import HelpButton from '@/client/components/common/help-button.vue';
import EmptyLayout from '@/client/components/common/empty_state.vue';

const route = useRoute();
const router = useRouter();
const calendarStore = useCalendarStore();
const authn = inject<{ isAdmin?: () => boolean }>('authn');
const isAdmin = () => authn?.isAdmin?.() ?? false;

const { t } = useTranslation('calendars', { keyPrefix: 'management' });
const { t: tSettings } = useTranslation('settings');

const loading = ref(true);
const error = ref<string | null>(null);
const settled = computed(() => !loading.value && !error.value);

// Both null until the load settles, and null for an unresolved calendar.
const info = computed(() => (
  settled.value ? findViewerCalendar(route.params.calendar, calendarStore.calendarInfos) : null
));
const navContext = computed(() => (
  settled.value ? buildSettingsNavContext('calendar', route.params.calendar, readSettingsNavSources(isAdmin)) : null
));

const instanceHost = computed(() => new Config().settings()?.domain);

/** Whether a calendar route may render: the index always, a leaf when visible to the viewer. */
const leafAllowed = (name: unknown): boolean => {
  const ctx = navContext.value;
  if (!ctx || typeof name !== 'string') {
    return false;
  }
  return name === SETTINGS_GROUP_INDEX_ROUTES.calendar || isVisibleLeaf('calendar', name, ctx);
};

/** The props each calendar route's component declares, so none falls through as a DOM attribute. */
const leafProps = (name: unknown): Record<string, unknown> => {
  const current = info.value;
  if (!current) {
    return {};
  }
  const calendarId = current.calendar.id;
  switch (name) {
    case 'calendar_general':
    case 'calendar_reports':
    case 'calendar_report_detail':
      return { calendarId };
    case 'calendar_editors':
      return { calendarId, isOwner: current.isOwner };
    case 'calendar_import':
      return { calendarId, instanceHost: instanceHost.value };
    case 'calendar_widget':
      return { calendarId, calendarUrlName: current.calendar.urlName };
    default:
      return {};
  }
};

// The owner-only gate. Only calendar leaves (and their sub-routes) are
// gated: the index is skipped by name, and a route outside the calendar
// group, seen while this pane is leaving, is never redirected.
watch([() => route.name, navContext], ([name, ctx]) => {
  if (!ctx || typeof name !== 'string' || findLeafByRouteName(name)?.group !== 'calendar') {
    return;
  }
  if (!isVisibleLeaf('calendar', name, ctx)) {
    router.replace(firstVisibleLeaf('calendar', ctx));
  }
}, { immediate: true });

onBeforeMount(async () => {
  try {
    // The funding flag is part of the nav context every settings consumer builds.
    await Promise.all([
      new CalendarService().ensureCalendarsLoaded(),
      new FundingService().ensureInstanceFundingLoaded(),
    ]);
  }
  catch (loadError) {
    console.error('Failed to load calendar:', loadError);
    error.value = t('error_loading_calendar');
  }
  finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="calendar-management-root">
    <div role="status" class="sr-only">{{ loading ? tSettings('loading_calendar') : '' }}</div>

    <p v-if="error" class="calendar-management-root__error">{{ error }}</p>

    <template v-else-if="navContext">
      <div class="calendar-management-root__help">
        <HelpButton />
      </div>
      <RouterView v-slot="{ Component, route: leafRoute }">
        <component
          :is="Component"
          v-if="Component && leafAllowed(leafRoute.name)"
          v-bind="leafProps(leafRoute.name)"
        />
      </RouterView>
    </template>

    <!-- One non-disclosing message: does not distinguish "doesn't exist" from "no relationship" -->
    <EmptyLayout
      v-else-if="!loading"
      :title="t('calendar_not_available')"
      :description="t('calendar_not_available_description')"
    />
  </div>
</template>

<style scoped lang="scss">
.calendar-management-root {
  min-width: 0;

  &__help {
    display: flex;
    justify-content: flex-end;
  }

  &__error {
    margin: 0;
    color: var(--pav-text-error);
  }
}
</style>
