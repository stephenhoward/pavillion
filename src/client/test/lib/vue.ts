import { mount } from '@vue/test-utils';
import { Router } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import { createPinia, Pinia } from 'pinia';

interface MountConfig {
  provide?: Record<string, any>;
  props?: Record<string, any>;
  stubs?: Record<string, any>;
  pinia?: Pinia;
  // Attach the component to a live DOM node. Required for behavior that reads
  // the document (e.g. document.getElementById / element focus); omit it for
  // the common detached-mount case. Remember to unmount() to detach again.
  attachTo?: Element | string;
}

const mountComponent = (component: any, router: Router, config: MountConfig = {}) => {

  let pinia = config.pinia || createPinia();

  let defaultProvide: Record<string, any> = {
    authn: {},
    site_config: {},
  };

  if (config.provide) {
    for (let key in config.provide) {
      defaultProvide[key] = config.provide[key];
    }
  }

  if (!config.props) {
    config.props = {};
  }

  initI18Next();
  const wrapper = mount(component, {
    global: {
      plugins: [
        router,
        [I18NextVue, { i18next }],
        pinia,
      ],
      provide: defaultProvide,
      stubs: config.stubs || {},
    },
    props: config.props,
    ...(config.attachTo ? { attachTo: config.attachTo } : {}),
  });

  return wrapper;
};

export { mountComponent };
