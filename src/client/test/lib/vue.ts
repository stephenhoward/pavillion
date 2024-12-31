import { mount } from '@vue/test-utils';
import { Router } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { createPinia } from 'pinia';

const mountComponent = (component: any, router: Router, config: Record<string, any> ) => {

    let i18n = createI18n({
        legacy: false,
        locale: 'en',
        messages: {}
    });
    let pinia = createPinia();

    let defaultProvide: Record<string, any> = {
        i18n: i18n,
        authn: {},
        site_config: {}
    }
    if (config.provide ) {
        for ( let key in config.provide ) {
            defaultProvide[key] = config.provide[key];
        }
    }

    if (! config.props ) {
        config.props = {};
    }

    const wrapper = mount(component, {
        global: {
            plugins: [router, i18n, pinia],
            provide: defaultProvide
        },
        props: config.props
    });

    return wrapper;
};

export { mountComponent };