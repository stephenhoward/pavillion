import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useWidgetStore } from './stores/widgetStore';
import WidgetContainer from './components/WidgetContainer.vue';
import EventDetailOverlay from './components/EventDetailOverlay.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/widget/:urlName',
    name: 'widget-calendar',
    component: WidgetContainer,
    beforeEnter: (to) => {
      const store = useWidgetStore();

      // Parse URL parameters for widget configuration
      const urlParams = new URLSearchParams(window.location.search);
      store.parseConfig(urlParams);

      // Set calendar URL name from route params
      if (typeof to.params.urlName === 'string') {
        store.setCalendarUrlName(to.params.urlName);
      }
    },
  },
  {
    path: '/widget/:urlName/events/:eventId',
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
