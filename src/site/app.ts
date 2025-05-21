import { createApp, App } from 'vue';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { initI18Next } from '@/site/service/locale';
import '@/site/assets/style.scss';
import AppVue from '@/site/components/app.vue';
import CalendarView from '@/site/components/calendar.vue';
import EventView from '@/site/components/event.vue';
import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';

Config.init().then( (config) => {

  const app: App = createApp(AppVue);
  const authentication = new Authentication(localStorage);

  const routes: RouteRecordRaw[] = [
    { path: '/@:calendar', component: CalendarView, name: 'calendar' },
    { path: '/@:calendar/events/:event', component: EventView, name: 'event' },
  ];

  const router = createRouter({
    history: createWebHistory(),
    routes,
  });

  const pinia = createPinia();
  initI18Next();
  app.use(pinia);
  app.use(router);
  app.use(I18NextVue, { i18next });
  app.provide('authn', authentication);
  app.provide('site_config', config);
  app.mount('#app');

});
