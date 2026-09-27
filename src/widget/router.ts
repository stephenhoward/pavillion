import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { INSTANCE_SLUG_PATTERN } from '@/common/utils/instance-slug';
import { useWidgetStore } from './stores/widgetStore';
import WidgetContainer from './components/widget-container.vue';
import EventDetailOverlay from './components/event-detail-overlay.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/widget/:urlName',
    name: 'widget-calendar',
    component: WidgetContainer,
  },
  {
    path: `/widget/:urlName/events/:eventId/:startTime(${INSTANCE_SLUG_PATTERN})?`,
    name: 'widget-event-detail',
    component: EventDetailOverlay,
  },
];

/**
 * Load the calendar's widget display config (view/accentColor/colorMode)
 * into the store, once per calendar.
 *
 * Runs from a router guard rather than a component hook because the guard
 * holds navigation until it resolves: every route — including a direct entry
 * to event detail, which never mounts widget-container.vue — renders with the
 * calendar's configured theme and accent rather than the defaults.
 *
 * Server config is authoritative; admin-preview URL params are applied AFTER
 * it so they take precedence (see `widgetStore.parseConfig`). A failed fetch
 * falls back to defaults and still lets the navigation through.
 *
 * @param urlName - Calendar URL name from the route
 */
async function loadWidgetConfig(urlName: string): Promise<void> {
  const store = useWidgetStore();
  if (store.configLoadedForUrlName === urlName) {
    return;
  }

  try {
    const response = await fetch(`/api/widget/v1/calendars/${encodeURIComponent(urlName)}`, {
      credentials: 'omit',
      headers: { 'Accept': 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      store.applyServerConfig(data.widgetConfig);
    }
    else {
      store.applyServerConfig(null);
    }
  }
  catch (err) {
    console.warn('[widget-router] Failed to load widget config from server, using defaults.', err);
    store.applyServerConfig(null);
  }

  store.parseConfig(new URLSearchParams(window.location.search));
  store.setConfigLoadedForUrlName(urlName);
}

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (typeof to.params.urlName !== 'string') {
    return;
  }

  useWidgetStore().setCalendarUrlName(to.params.urlName);
  await loadWidgetConfig(to.params.urlName);
});

// Remember the list's query whenever the visitor leaves it for event detail,
// so the detail's Back button can restore the same filters and date range.
// Done here rather than in each view's click handler because the list, week
// and month views all reach detail by different means (the list through the
// shared site event card), and this is the one place all of them pass.
router.afterEach((to, from, failure) => {
  if (failure || from.name !== 'widget-calendar' || to.name !== 'widget-event-detail') {
    return;
  }
  useWidgetStore().setLastListQuery(from.query);
});

export default router;
