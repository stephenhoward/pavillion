import { createApp, App } from 'vue';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { initI18Next } from '@/widget/service/locale';
import router from '@/widget/router';
import AppVue from '@/widget/components/app.vue';
import Config from '@/client/service/config';

/**
 * Widget app initialization
 * Loads configuration and initializes Vue app with router, i18n, and Pinia
 */
Config.init().then((config) => {
  const app: App = createApp(AppVue);
  const pinia = createPinia();

  // Initialize i18next for translations
  initI18Next();

  // Install plugins
  app.use(pinia);
  app.use(router);
  app.use(I18NextVue, { i18next });

  // Provide configuration
  app.provide('site_config', config);

  // Mount to the widget app div
  app.mount('#app');
});
