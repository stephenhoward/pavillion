import { createApp, App } from 'vue';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { initI18Next } from '@/client/service/locale';
import '@/client/assets/style/main.scss';

import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';

import AppVue from '@/client/components/app.vue';

import AuthViews from '@/client/components/logged_out/root.vue';
import LoginView from '@/client/components/logged_out/login.vue';
import LogoutView from '@/client/components/logged_out/logout.vue';
import PasswordForgotView from '@/client/components/logged_out/password_forgot.vue';
import PasswordResetView from '@/client/components/logged_out/password_reset.vue';
import RegisterView from '@/client/components/logged_out/register.vue';
import RegisterApplyView from '@/client/components/logged_out/register_apply.vue';
import AcceptInviteView from '@/client/components/logged_out/accept_invite.vue';

import AppViews from '@/client/components/logged_in/root.vue';
import CalendarsView from '@/client/components/logged_in/calendar/calendars.vue';
import CalendarView from '@/client/components/logged_in/calendar/calendar.vue';
import CalendarManagementView from '@/client/components/logged_in/calendar-management/root.vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import FeedView from '@/client/components/logged_in/feed/root.vue';
import ProfileView from '@/client/components/logged_in/settings/root.vue';
import InboxView from '@/client/components/logged_in/inbox.vue';

import AdminViews from '@/client/components/admin/root.vue';
import InvitesListView from '@/client/components/admin/accounts.vue';
import AdminSettingsView from '@/client/components/admin/settings.vue';
import FederationSettingsView from '@/client/components/admin/federation.vue';
import FundingSettingsView from '@/client/components/admin/funding.vue';

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

  const mustBeAdmin = (to, from, next) => {
    if (!authentication.isAdmin()) {
      next({ name: 'login'});
    }
    else {
      next();
    }
  };

  const routes: RouteRecordRaw[] = [
    { path: '/', component: AppViews, name: 'app', beforeEnter: mustBeLoggedIn,

      children: [
        { path: 'calendar', component: CalendarsView, name: 'calendars', beforeEnter: mustBeLoggedIn },
        { path: 'calendar/:calendar', component: CalendarView, name: 'calendar', beforeEnter: mustBeLoggedIn },
        { path: 'calendar/:calendar/manage', component: CalendarManagementView, name: 'calendar_management', beforeEnter: mustBeLoggedIn },
        { path: 'inbox', component: InboxView, name: 'inbox', beforeEnter: mustBeLoggedIn },
        { path: 'feed', component: FeedView, name: 'feed', beforeEnter: mustBeLoggedIn },
        { path: 'profile', component: ProfileView, name: 'profile', beforeEnter: mustBeLoggedIn },
      ],
    },
    // Event routes are top-level to render fullscreen without navigation
    { path: '/event', component: EditEventView, name: 'event_new', beforeEnter: mustBeLoggedIn },
    { path: '/event/:eventId', component: EditEventView, name: 'event_edit', beforeEnter: mustBeLoggedIn, props: true },
    { path: '/admin', component: AdminViews, name: 'admin', beforeEnter: mustBeAdmin,
      children: [
        { path: 'settings', component: AdminSettingsView, name: 'admin_settings', beforeEnter: mustBeAdmin },
        { path: 'accounts', component: InvitesListView, name: 'accounts', beforeEnter: mustBeAdmin },
        { path: 'federation', component: FederationSettingsView, name: 'federation', beforeEnter: mustBeAdmin },
        { path: 'funding', component: FundingSettingsView, name: 'funding', beforeEnter: mustBeAdmin },
      ],
    },
    { path: '/auth', component: AuthViews, name: 'auth',
      children: [
        { path: 'login',  component: LoginView, name: 'login', props: true },
        { path: 'logout', component: LogoutView, name: 'logout' },
        { path: 'register',  component: RegisterView, name: 'register', props: true },
        { path: 'invitation', component: AcceptInviteView, name: 'accept_invite', props: true },
        { path: 'apply',  component: RegisterApplyView, name: 'register-apply', props: true },
        { path: 'forgot', component: PasswordForgotView, name: 'forgot_password', props: true },
        { path: 'password',  component: PasswordResetView, name: 'reset_password', props: true },
      ],
    },
  ];

  const router = createRouter({
    history: createWebHistory(),
    routes,
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
