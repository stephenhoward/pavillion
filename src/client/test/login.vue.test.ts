import{ expect, describe, it } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';

import { mountComponent } from '@/client/test/lib/vue';
import Login from '@/client/components/authentication/login.vue';

const routes: RouteRecordRaw[] = [
    { path: '/login',  component: {}, name: 'login', props: true },
    { path: '/logout', component: {}, name: 'logout' },
    { path: '/register', component: {}, name: 'register', props: true },
    { path: '/forgot', component: {}, name: 'forgot_password', props: true },
    { path: '/apply',  component: {}, name: 'register-apply', props: true },
    { path: '/reset',  component: {}, name: 'reset_password', props: true }
];

const mountedLogin = () => {
    let router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes
    });
    let authn = {
        login: async (email: string, password: string) => {
            return false;
        }
    }

    const wrapper = mountComponent(Login, router, {
        provide: {
            site_config: {
                settings: () => { return {};}
            },
            authn
        }
    });

    return {
        wrapper,
        router,
        authn
    }
};

describe('Login Screen', () => {

    let router = createRouter({
        history: createMemoryHistory(),
        routes: routes
    });
    const wrapper = mountComponent(Login, router, {
        provide: {
            site_config: {
                settings: () => { return {}; }
            }
        }
    });

    it('should show basic login components', () => {
        expect(wrapper.find('div.error').exists()).toBe(false);
        expect(wrapper.find('input[type="email"]').exists()).toBe(true);
        expect(wrapper.find('input[type="password"]').exists()).toBe(true);
        expect(wrapper.find('button[type="submit"]').exists()).toBe(true);

        expect(wrapper.find('#register').exists()).toBe(false);
        expect(wrapper.find('#apply').exists()).toBe(false);
    });

    describe('Closed Registration', () => {
        const closedWrapper = mountComponent(Login, router, {
            provide: {
                site_config: {
                    settings: () => { return {
                        registrationMode: 'closed'
                    };}
                }
            }
        });
        it('no registration link', () => {
            expect(closedWrapper.find('#register').exists()).toBe(false);
        });
    
        it('no apply link', () => {
            expect(closedWrapper.find('#apply').exists()).toBe(false);
        });
    });

    describe('Open Registration', () => {
        const openWrapper = mountComponent(Login, router, {
            provide: {
                site_config: {
                    settings: () => { return {
                        registrationMode: 'open'
                    };}
                }
            }
        });
        it('has registration link', () => {
            expect(openWrapper.find('#register').exists()).toBe(true);
        });
    
        it('no apply link', () => {
            expect(openWrapper.find('#apply').exists()).toBe(false);
        });
    });

    describe('Open Applies', () => {
        const applyWrapper = mountComponent(Login, router, {
            provide: {
                site_config: {
                    settings: () => { return {
                        registrationMode: 'apply'
                    };}
                }
            }
        });
        it('no registration link', () => {
            expect(applyWrapper.find('#register').exists()).toBe(false);
        });
    
        it('has apply link', () => {
            expect(applyWrapper.find('#apply').exists()).toBe(true);
        });
    });

});

describe('Login Behavior', () => {

    it('missing email', async () => {
        const { wrapper, router, authn } = mountedLogin();
        let pushStub = sinon.createSandbox().stub(router, 'push');
        let loginStub = sinon.createSandbox().stub(authn, 'login');


        wrapper.find('input[type="email"]').setValue('');
        wrapper.find('input[type="password"]').setValue('password');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(wrapper.find('div.error').exists()).toBe(true);
        expect(pushStub.called).toBe(false);
        expect(loginStub.called).toBe(false);
    });

    it('missing password', async () => {
        const { wrapper, router, authn } = mountedLogin();
        let pushStub = sinon.createSandbox().stub(router, 'push');
        let loginStub = sinon.createSandbox().stub(authn, 'login');


        wrapper.find('input[type="email"]').setValue('email');
        wrapper.find('input[type="password"]').setValue('');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(wrapper.find('div.error').exists()).toBe(true);
        expect(pushStub.called).toBe(false);
        expect(loginStub.called).toBe(false);
    });


    it('fail login', async () => {
        const { wrapper, router, authn } = mountedLogin();
        let pushStub = sinon.createSandbox().stub(router, 'push');
        let loginStub = sinon.createSandbox().stub(authn, 'login');

        loginStub.resolves(false);

        wrapper.find('input[type="email"]').setValue('email');
        wrapper.find('input[type="password"]').setValue('password');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(wrapper.find('div.error').exists()).toBe(true);
        expect(pushStub.called).toBe(false);
        expect(loginStub.called).toBe(true);
    });

    it('catch login error', async () => {
        const { wrapper, router, authn } = mountedLogin();
        let pushStub = sinon.createSandbox().stub(router, 'push');
        let loginStub = sinon.createSandbox().stub(authn, 'login');

        loginStub.throws("ouch");

        wrapper.find('input[type="email"]').setValue('email');
        wrapper.find('input[type="password"]').setValue('password');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(wrapper.find('div.error').exists()).toBe(true);
        expect(pushStub.called).toBe(false);
        expect(loginStub.called).toBe(true);
    });

    it('login succeeds', async () => {
        const { wrapper, router, authn } = mountedLogin();
        let pushStub = sinon.createSandbox().stub(router, 'push');
        let loginStub = sinon.createSandbox().stub(authn, 'login');

        loginStub.resolves(true);

        wrapper.find('input[type="email"]').setValue('email');
        wrapper.find('input[type="password"]').setValue('password');
        
        await wrapper.find('button[type="submit"]').trigger('click');

        expect(wrapper.find('div.error').exists()).toBe(false);
        expect(pushStub.called).toBe(true);
        expect(loginStub.called).toBe(true);
    });
});