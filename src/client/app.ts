import { createApp, App } from 'vue';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { createI18n, useI18n } from 'vue-i18n';
import { createPinia } from 'pinia';

import '@/client/assets/style.scss';
import AppVue from '@/client/components/app.vue';
import CalendarsView from '@/client/components/calendars.vue';
import CalendarView from '@/client/components/calendar.vue';
import FeedView from '@/client/components/feed.vue';
import ProfileView from '@/client/components/profile.vue';
import InboxView from '@/client/components/inbox.vue';
import AppViews from '@/client/components/app_views.vue';
import AuthViews from '@/client/components/auth_views.vue';
import AdminViews from '@/client/components/admin_views.vue';
import LoginView from '@/client/components/login.vue';
import LogoutView from '@/client/components/logout.vue';
import PasswordForgotView from '@/client/components/password_forgot.vue';
import PasswordResetView from '@/client/components/password_reset.vue';
import RegisterView from '@/client/components/register.vue';
import RegisterApplyView from '@/client/components/register_apply.vue';
import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';

Config.init().then( (config) => {

const app: App = createApp(AppVue);
const authentication = new Authentication(localStorage);

const mustBeLoggedIn = (to, from, next) => {
    if (!authentication.isLoggedIn()) {
        next({ name: 'login'});
    }
    else {
        next();
    }
};

const mustBeAdmin = (to, from) => {
    if (!authentication.isAdmin()) {
        return false;
    }
};

const routes: RouteRecordRaw[] = [
    { path: '/', component: AppViews, name: 'app', beforeEnter: mustBeLoggedIn,

        children: [
            { path: 'calendar', component: CalendarsView, name: 'calendars', beforeEnter: mustBeLoggedIn },
            { path: 'calendar/:id', component: CalendarView, name: 'calendar', beforeEnter: mustBeLoggedIn },
            { path: 'inbox', component: InboxView, name: 'inbox', beforeEnter: mustBeLoggedIn },
            { path: 'feed', component: FeedView, name: 'feed', beforeEnter: mustBeLoggedIn },
            { path: 'profile', component: ProfileView, name: 'profile', beforeEnter: mustBeLoggedIn },
       ]
    },
    { path: '/auth', component: AuthViews, name: 'auth',
        children: [
            { path: 'login',  component: LoginView, name: 'login', props: true },
            { path: 'logout', component: LogoutView, name: 'logout' },
            { path: 'register',  component: RegisterView, name: 'register', props: true },
            { path: 'apply',  component: RegisterApplyView, name: 'register-apply', props: true },
            { path: 'forgot', component: PasswordForgotView, name: 'forgot_password', props: true },
            { path: 'password',  component: PasswordResetView, name: 'reset_password', props: true }
        ]
    },
    { path: '/admin', component: AdminViews, name: 'admin', beforeEnter: mustBeAdmin,
        children: []
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

const i18n = createI18n({
    legacy: false,
    globalInjection: false,
    locale: navigator.language.substring(0,2),
    fallbackLocale: 'en',
    // datetimeFormats,
});

const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);
app.provide('i18n', i18n);
app.provide('authn', authentication);
app.provide('site_config',config);
app.mount('#app');

});
