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
 *   mounts: on entry by the parent record's calendarLeafGate, on a move
 *   within the subtree by onBeforeRouteUpdate here, both before commit, and
 *   in place when ownership is lost while mounted. One predicate,
 *   calendarLeafRedirect in settings-guards.ts, decides all three.
 *   Visibility is nav-items.ts's; hiding a leaf is a convenience, and the
 *   server endpoints each leaf calls stay the enforcement point.
 * - A nonexistent calendar and one the viewer is not a member of are the
 *   same unresolved calendar: one empty state at the unchanged URL, for the
 *   index and every leaf, and nothing renders the route param.
 * - Leaves receive the calendar and ownership as props from the calendar
 *   store entry; nothing is provided or injected.
 */
import { computed, inject, onBeforeMount, onMounted, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import Config from '@/client/service/config';
import { useCalendarStore } from '@/client/stores/calendarStore';
import {
  buildSettingsNavContext,
  calendarLeafRedirect,
  findViewerCalendar,
  historyPath,
  readSettingsNavSources,
  withHistoryMode,
} from '@/client/service/settings-guards';
import {
  isVisibleLeaf,
  SETTINGS_GROUP_INDEX_ROUTES,
} from '@/client/components/logged_in/settings/nav-items';
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

// The status region mounts empty and receives its text after mount: a live
// region inserted with its text already present is not announced by many
// screen readers.
const mounted = ref(false);
onMounted(() => {
  mounted.value = true;
});
const statusText = computed(() => (mounted.value && loading.value ? tSettings('loading_calendar') : ''));

// Both null until the load settles, and null for an unresolved calendar.
const info = computed(() => (
  settled.value ? findViewerCalendar(route.params.calendar, calendarStore.calendarInfos) : null
));
const navContext = computed(() => (
  settled.value ? buildSettingsNavContext('calendar', route.params.calendar, readSettingsNavSources(isAdmin)) : null
));

const instanceHost = computed(() => new Config().settings()?.domain);

/**
 * Whether a calendar route may render: the index always, a leaf when visible
 * to the viewer. Deliberately separate from calendarLeafRedirect: an unknown or
 * unresolved route renders nothing here but is never redirected.
 */
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
    case 'calendar_editors':
    case 'calendar_reports':
    case 'calendar_report_detail':
      return { calendarId };
    case 'calendar_import':
      return { calendarId, instanceHost: instanceHost.value };
    case 'calendar_widget':
      return { calendarId, calendarUrlName: current.calendar.urlName };
    default:
      return {};
  }
};

// Entering the subtree is gated before commit by the parent record's
// calendarLeafGate. This catches what reaches a mounted pane anyway:
// ownership lost while mounted, or a gate that passed on a failed load.
watch([() => route.name, navContext], ([name, ctx]) => {
  const target = calendarLeafRedirect(name, ctx);
  if (target) {
    router.replace(target);
  }
}, { immediate: true });

// An in-app move between leaves is gated before it commits, so a refused
// leaf leaves no history entry behind. A move to another calendar is judged
// against that calendar; one the viewer cannot resolve gets no context and
// passes through to the remounted pane's empty state.
onBeforeRouteUpdate((to) => {
  if (!settled.value) {
    return true;
  }
  const ctx = buildSettingsNavContext('calendar', to.params.calendar, readSettingsNavSources(isAdmin));
  const target = calendarLeafRedirect(to.name, ctx);
  return target ? withHistoryMode(target, to, () => historyPath(router)) : true;
});

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
    <div role="status" class="sr-only">{{ statusText }}</div>

    <p
      v-if="error"
      class="calendar-management-root__error"
      role="alert"
      aria-live="polite"
    >
      {{ error }}
    </p>

    <template v-else-if="navContext">
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

  &__error {
    margin: 0;
    color: var(--pav-text-error);
  }
}
</style>
