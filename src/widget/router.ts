import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useWidgetStore } from './stores/widgetStore';
import WidgetContainer from './components/widget-container.vue';
import EventDetailOverlay from './components/event-detail-overlay.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/widget/:urlName',
    name: 'widget-calendar',
    component: WidgetContainer,
    beforeEnter: (to) => {
      const store = useWidgetStore();

      // Widget display config (view/accentColor/colorMode) is fetched from
      // the server by widget-container.vue on mount. URL-param overrides
      // for the admin preview iframe are also applied there, AFTER the
      // authoritative server config, so they take precedence.

      // Set calendar URL name from route params
      if (typeof to.params.urlName === 'string') {
        store.setCalendarUrlName(to.params.urlName);
      }
    },
  },
  {
    path: '/widget/:urlName/events/:eventId/:startTime(\\d{8}-\\d{4})?',
    name: 'widget-event-detail',
    component: EventDetailOverlay,
    beforeEnter: (to) => {
      const store = useWidgetStore();

      // Ensure calendar URL name is set
      if (typeof to.params.urlName === 'string') {
        store.setCalendarUrlName(to.params.urlName);
      }
    },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
