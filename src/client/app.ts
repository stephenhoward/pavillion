import { createApp, App } from 'vue';
import './assets/style.scss';
import AppVue from './components/app.vue';
import CalendarView from './components/calendar.vue';
import FeedView from './components/feed.vue';
import ProfileView from './components/profile.vue';
import InboxView from './components/inbox.vue';
import AppViews from './components/app_views.vue';
import AuthViews from './components/auth_views.vue';
import LoginView from './components/login.vue';
import LogoutView from './components/logout.vue';
import PasswordForgotView from './components/password_forgot.vue';
import PasswordResetView from './components/password_reset.vue';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { createI18n, useI18n } from 'vue-i18n';
import Authentication from './service/authn';

const app: App = createApp(AppVue);

const routes: RouteRecordRaw[] = [
    { path: '/', component: AppViews, name: 'app',
        children: [
            { path: 'calendar', component: CalendarView, name: 'calendar' },
            { path: 'inbox', component: InboxView, name: 'inbox' },
            { path: 'feed', component: FeedView, name: 'feed' },
            { path: 'profile', component: ProfileView, name: 'profile' },
       ]
    },
    { path: '/auth', component: AuthViews, name: 'auth',
        children: [
            { path: 'login',  component: LoginView, name: 'login', props: true },
            { path: 'logout', component: LogoutView, name: 'logout' },
            { path: 'forgot', component: PasswordForgotView, name: 'forgot_password', props: true },
            { path: 'reset',  component: PasswordResetView, name: 'reset_password', props: true }
        ]
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

const authentication = new Authentication(window.sessionStorage);

const i18n = createI18n({
    legacy: false,
    globalInjection: false,
    locale: navigator.language.substring(0,2),
    fallbackLocale: 'en',
    // datetimeFormats,
});

app.use(router);
app.use(i18n);
app.provide('i18n', i18n);
app.provide('authn', authentication);
app.mount('#app');
