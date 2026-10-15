import { createApp, App } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { initI18Next } from '@/client/service/locale';
import '@/client/assets/style/main.scss';

import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';
import SetupService from '@/client/service/setup';
import CalendarService from '@/client/service/calendar';
import { createCurrentCalendarRedirect, createCurrentCalendarSync } from '@/client/service/current-calendar';
import { buildClientRoutes } from '@/client/routes';
import { createRouteGuards } from '@/client/service/route-guards';

import AppVue from '@/client/components/app.vue';

// Track setup mode status globally
let isSetupMode = false;

/**
 * Check if setup mode is active by calling the setup status API.
 * Updates the global isSetupMode flag.
 */
async function checkSetupMode(): Promise<boolean> {
  try {
    const setupService = new SetupService();
    const status = await setupService.checkSetupStatus();
    isSetupMode = status.setupRequired;
    return isSetupMode;
  }
  catch {
    // If we can't check status, assume setup is not required
    isSetupMode = false;
    return false;
  }
}

// Check setup status before initializing the app
checkSetupMode().then((setupRequired) => {

  Config.init().then((config) => {

    const app: App = createApp(AppVue);
    const authentication = new Authentication(localStorage);

    const loadCalendars = () => new CalendarService().ensureCalendarsLoaded();

    const routes = buildClientRoutes({
      ...createRouteGuards(authentication, () => isSetupMode),
      currentCalendarRedirect: (routeName, fallback) => createCurrentCalendarRedirect(routeName, fallback, loadCalendars),
    });

    const router = createRouter({
      history: createWebHistory(),
      routes,
    });

    // Global navigation guard to enforce setup mode
    router.beforeEach((to, from, next) => {
      if (isSetupMode && to.name !== 'setup') {
        next({ name: 'setup' });
      }
      else {
        next();
      }
    });

    // The URL is the source of truth for the current calendar (see current-calendar.ts).
    router.beforeEach(createCurrentCalendarSync(() => authentication.isLoggedIn(), loadCalendars));

    const pinia = createPinia();
    initI18Next(config.settings().defaultLanguage);
    app.use(pinia);
    app.use(router);
    app.use(I18NextVue, { i18next });
    app.provide('authn', authentication);
    app.provide('site_config', config);

    // If setup mode is active, navigate to setup after mount
    if (setupRequired) {
      router.isReady().then(() => {
        router.push({ name: 'setup' });
      });
    }

    app.mount('#app');

  });
});
