import { createApp, App } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { initI18Next } from '@/site/service/locale';
import '@/site/assets/style.scss';
import AppVue from '@/site/components/app.vue';
import CalendarView from '@/site/components/calendar.vue';
import EventView from '@/site/components/event.vue';
import EventInstanceView from '@/site/components/event-instance.vue';
import SeriesView from '@/site/components/series-view.vue';
import Discovery from '@/site/components/discovery.vue';
import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';
import { buildSiteRoutes, siteScrollBehavior } from '@/site/routes';

Config.init().then( async (config) => {

  // Initialize i18next BEFORE creating the app to prevent a flash of English
  // content when a non-default locale URL is loaded for the first time.
  await initI18Next();

  const app: App = createApp(AppVue);
  const authentication = new Authentication(localStorage);

  // The path table lives in @/site/routes so a test can import the shipped
  // shapes rather than mirror them; this module only binds the views to it.
  const router = createRouter({
    history: createWebHistory(),
    routes: buildSiteRoutes({
      discovery: Discovery,
      calendar: CalendarView,
      event: EventView,
      instance: EventInstanceView,
      series: SeriesView,
    }),
    scrollBehavior: siteScrollBehavior,
  });

  router.beforeEach((to) => {
    const locale = to.params.locale as string | undefined;
    if (locale && i18next.language !== locale) {
      i18next.changeLanguage(locale);
    }
  });

  const pinia = createPinia();
  app.use(pinia);
  app.use(router);
  app.use(I18NextVue, { i18next });
  app.provide('authn', authentication);
  app.provide('site_config', config);

  // Wait for the router to resolve the initial navigation before mounting so
  // the correct locale is applied before the first render.
  await router.isReady();
  app.mount('#app');

});
