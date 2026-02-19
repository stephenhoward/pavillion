import { createApp, App } from 'vue';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { createPinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import { initI18Next } from '@/client/service/locale';
import '@/client/assets/style/main.scss';

import Authentication from '@/client/service/authn';
import Config from '@/client/service/config';
import SetupService from '@/client/service/setup';

import AppVue from '@/client/components/app.vue';

import AuthViews from '@/client/components/logged_out/root.vue';
import LoginView from '@/client/components/logged_out/login.vue';
import LogoutView from '@/client/components/logged_out/logout.vue';
import PasswordForgotView from '@/client/components/logged_out/password_forgot.vue';
import PasswordResetView from '@/client/components/logged_out/password_reset.vue';
import RegisterView from '@/client/components/logged_out/register.vue';
import RegisterApplyView from '@/client/components/logged_out/register_apply.vue';
import AcceptInviteView from '@/client/components/logged_out/accept_invite.vue';
import SetupView from '@/client/components/logged_out/setup.vue';

import AppViews from '@/client/components/logged_in/root.vue';
import CalendarsView from '@/client/components/logged_in/calendar/calendars.vue';
import CalendarView from '@/client/components/logged_in/calendar/calendar.vue';
import CalendarManagementView from '@/client/components/logged_in/calendar-management/root.vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import FeedView from '@/client/components/logged_in/feed/root.vue';
import ProfileView from '@/client/components/logged_in/settings/root.vue';
import CalendarCategoryMappingsView from '@/client/components/logged_in/settings/calendar-category-mappings.vue';
import InboxView from '@/client/components/logged_in/inbox.vue';
import SubscriptionView from '@/client/components/account/subscription.vue';

import AdminViews from '@/client/components/admin/root.vue';
import InvitesListView from '@/client/components/admin/accounts.vue';
import AdminSettingsView from '@/client/components/admin/settings.vue';
import FederationSettingsView from '@/client/components/admin/federation.vue';
import FundingSettingsView from '@/client/components/admin/funding.vue';
import ModerationDashboardView from '@/client/components/admin/moderation-dashboard.vue';
import ReportDetailView from '@/client/components/admin/report-detail.vue';
import ModerationSettingsView from '@/client/components/admin/moderation-settings.vue';
import BlockedInstancesView from '@/client/components/admin/blocked-instances.vue';

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

    const mustBeLoggedIn = (to, from, next) => {
      // If in setup mode, redirect to setup
      if (isSetupMode && to.name !== 'setup') {
        next({ name: 'setup' });
        return;
      }
      if (!authentication.isLoggedIn()) {
        next({ name: 'login' });
      }
      else {
        next();
      }
    };

    const mustBeAdmin = (to, from, next) => {
      // If in setup mode, redirect to setup
      if (isSetupMode && to.name !== 'setup') {
        next({ name: 'setup' });
        return;
      }
      if (!authentication.isAdmin()) {
        next({ name: 'login' });
      }
      else {
        next();
      }
    };

    /**
     * Route guard for the setup route.
     * Only allow access when setup mode is active.
     */
    const setupGuard = (to, from, next) => {
      if (!isSetupMode) {
        // Setup already completed, redirect to login
        next({ name: 'login' });
      }
      else {
        next();
      }
    };

    /**
     * Route guard for auth routes during setup mode.
     * Redirect to setup if setup mode is active.
     */
    const authRouteGuard = (to, from, next) => {
      if (isSetupMode && to.name !== 'setup') {
        next({ name: 'setup' });
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
          { path: 'subscription', component: SubscriptionView, name: 'subscription', beforeEnter: mustBeLoggedIn },
          {
            path: 'calendar/:calendarId/following/:actorId/category-mappings',
            component: CalendarCategoryMappingsView,
            name: 'calendar_category_mappings',
            beforeEnter: mustBeLoggedIn,
            props: true,
            meta: { activeNav: 'feed' },
          },
        ],
      },
      // Event routes are top-level to render fullscreen without navigation
      { path: '/event', component: EditEventView, name: 'event_new', beforeEnter: mustBeLoggedIn },
      { path: '/event/:eventId', component: EditEventView, name: 'event_edit', beforeEnter: mustBeLoggedIn, props: true },
      { path: '/admin', component: AdminViews, name: 'admin', beforeEnter: mustBeAdmin,
        children: [
          { path: 'settings', component: AdminSettingsView, name: 'admin_settings', beforeEnter: mustBeAdmin },
          { path: 'accounts', component: InvitesListView, name: 'accounts', beforeEnter: mustBeAdmin },
          { path: 'moderation', component: ModerationDashboardView, name: 'moderation', beforeEnter: mustBeAdmin },
          { path: 'moderation/reports/:reportId', component: ReportDetailView, name: 'moderation_report_detail', beforeEnter: mustBeAdmin },
          { path: 'moderation/settings', component: ModerationSettingsView, name: 'moderation_settings', beforeEnter: mustBeAdmin },
          { path: 'moderation/blocked-instances', component: BlockedInstancesView, name: 'blocked_instances', beforeEnter: mustBeAdmin },
          { path: 'federation', component: FederationSettingsView, name: 'federation', beforeEnter: mustBeAdmin },
          { path: 'funding', component: FundingSettingsView, name: 'funding', beforeEnter: mustBeAdmin },
        ],
      },
      // Setup route - uses AuthViews layout but has its own guard
      { path: '/setup', component: AuthViews, beforeEnter: setupGuard,
        children: [
          { path: '', component: SetupView, name: 'setup' },
        ],
      },
      { path: '/auth', component: AuthViews, name: 'auth', beforeEnter: authRouteGuard,
        children: [
          { path: 'login', component: LoginView, name: 'login', props: true, beforeEnter: authRouteGuard },
          { path: 'logout', component: LogoutView, name: 'logout' },
          { path: 'register', component: RegisterView, name: 'register', props: true, beforeEnter: authRouteGuard },
          { path: 'invitation', component: AcceptInviteView, name: 'accept_invite', props: true, beforeEnter: authRouteGuard },
          { path: 'apply', component: RegisterApplyView, name: 'register-apply', props: true, beforeEnter: authRouteGuard },
          { path: 'forgot', component: PasswordForgotView, name: 'forgot_password', props: true, beforeEnter: authRouteGuard },
          { path: 'password', component: PasswordResetView, name: 'reset_password', props: true, beforeEnter: authRouteGuard },
        ],
      },
    ];

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
