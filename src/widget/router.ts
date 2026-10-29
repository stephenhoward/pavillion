import { createRouter, createWebHistory, type RouteRecordRaw, type RouterScrollBehavior } from 'vue-router';
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

/**
 * Where the widget's window scroll lands after an in-widget navigation.
 *
 * Without this, opening an event from partway down the list leaves the detail
 * at the same scroll offset, with its title and Back link off-screen. The rule
 * matches the site's (`siteScrollBehavior` in src/site/routes.ts):
 *
 * - Back/forward restores the position the browser saved for that entry.
 * - Arriving at a different view (list → detail) starts at the top.
 * - Staying on the same view (filter or date changes rewriting the query)
 *   keeps the reader's place.
 *
 * This covers a widget loaded directly, where its own window scrolls. Embedded
 * in an iframe that resizes to its content, the widget window never scrolls
 * and the host page owns scrolling; that case is handled separately.
 *
 * @returns The saved position, the top of the page, or false to leave scroll alone
 */
export const widgetScrollBehavior: RouterScrollBehavior = (to, from, savedPosition) => {
  if (savedPosition) {
    return savedPosition;
  }

  const toView = to.matched[0]?.components?.default;
  const fromView = from.matched[0]?.components?.default;
  if (toView !== fromView) {
    return { top: 0 };
  }

  return false;
};

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: widgetScrollBehavior,
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
// The recorded query belongs to one calendar, so it is dropped whenever
// navigation moves to another; Back must never apply one calendar's filters
// to another calendar's list.
router.afterEach((to, from, failure) => {
  if (failure) {
    return;
  }
  const store = useWidgetStore();
  if (from.params.urlName !== to.params.urlName) {
    store.clearLastListQuery();
    return;
  }
  if (from.name === 'widget-calendar' && to.name === 'widget-event-detail') {
    store.setLastListQuery(from.query);
  }
});

export default router;
