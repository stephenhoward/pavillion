import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, RouteRecordRaw, Router } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { createApp } from 'vue';
import { k } from 'vite/dist/node/types.d-aGj9QkWt';

const mountComponent = (component: any, router: Router, provide: Record<string, any> ) => {

    let i18n = createI18n({
        legacy: false,
        locale: 'en',
        messages: {}
    });

    let defaultProvide: Record<string, any> = {
        i18n: i18n,
        authn: {},
        site_config: {}
    }
    for ( let key in provide ) {
        defaultProvide[key] = provide[key];
    }
    const wrapper = mount(component, {
        global: {
            plugins: [router, i18n],
            provide: defaultProvide
        }
    });

    return wrapper;
};

export { mountComponent };