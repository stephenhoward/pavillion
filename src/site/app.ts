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
import EventInstanceView from '@/site/components/eventInstance.vue';
import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';
import { AVAILABLE_LANGUAGES, DEFAULT_LANGUAGE_CODE } from '@/common/i18n/languages';

Config.init().then( (config) => {

  const app: App = createApp(AppVue);
  const authentication = new Authentication(localStorage);

  const routes: RouteRecordRaw[] = [
    { path: '/@:calendar', component: CalendarView, name: 'calendar' },
    { path: '/@:calendar/events/:event', component: EventView, name: 'event' },
    { path: '/@:calendar/events/:event/:instance', component: EventInstanceView, name: 'instance' },
  ];

  const nonDefaultLocales = AVAILABLE_LANGUAGES
    .filter(lang => lang.code !== DEFAULT_LANGUAGE_CODE)
    .map(lang => lang.code);

  if (nonDefaultLocales.length > 0) {
    const pattern = nonDefaultLocales.join('|');
    // Locale-prefixed variants — unnamed intentionally.
    // Navigation uses the default-locale named routes; useLocale.localizedPath() adds the prefix.
    routes.push(
      { path: `/:locale(${pattern})/@:calendar`, component: CalendarView },
      { path: `/:locale(${pattern})/@:calendar/events/:event`, component: EventView },
      { path: `/:locale(${pattern})/@:calendar/events/:event/:instance`, component: EventInstanceView },
    );
  }

  const router = createRouter({
    history: createWebHistory(),
    routes,
  });

  router.beforeEach((to) => {
    const locale = to.params.locale as string | undefined;
    if (locale) {
      i18next.changeLanguage(locale);
    }
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
