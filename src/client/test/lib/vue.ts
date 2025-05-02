import { mount } from '@vue/test-utils';
import { Router } from 'vue-router';
import I18NextVue from 'i18next-vue';
import i18next from 'i18next';
import { initI18Next } from '@/client/service/locale';
import { createPinia } from 'pinia';

const mountComponent = (component: any, router: Router, config: Record<string, any> ) => {

    let pinia = createPinia();

    let defaultProvide: Record<string, any> = {
        authn: {},
        site_config: {}
    }

    if ( config.provide ) {
        for ( let key in config.provide ) {
            defaultProvide[key] = config.provide[key];
        }
    }

    if (! config.props ) {
        config.props = {};
    }

    initI18Next();
    const wrapper = mount(component, {
        global: {
            plugins: [
                router,
                [I18NextVue, { i18next }],
                pinia
            ],
            provide: defaultProvide,
        },
        props: config.props
    });

    return wrapper;
};

export { mountComponent };