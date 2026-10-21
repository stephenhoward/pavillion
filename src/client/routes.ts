import type { NavigationGuard, RouteLocationRaw, RouteRecordRaw } from 'vue-router';

import AuthViews from '@/client/components/logged_out/root.vue';
import LoginView from '@/client/components/logged_out/login.vue';
import LogoutView from '@/client/components/logged_out/logout.vue';
import PasswordForgotView from '@/client/components/logged_out/password_forgot.vue';
import PasswordResetView from '@/client/components/logged_out/password_reset.vue';
import RegisterView from '@/client/components/logged_out/register.vue';
import RegisterApplyView from '@/client/components/logged_out/register_apply.vue';
import ApplyConfirmView from '@/client/components/logged_out/apply_confirm.vue';
import EmailConfirmView from '@/client/components/logged_out/email_confirm.vue';
import AcceptInviteView from '@/client/components/logged_out/accept_invite.vue';
import SetupView from '@/client/components/logged_out/setup.vue';
import InstancePolicyView from '@/client/components/logged_out/instance-policy.vue';

import AppViews from '@/client/components/logged_in/root.vue';
import NoCalendarsView from '@/client/components/logged_in/calendar/NoCalendars.vue';
import CalendarView from '@/client/components/logged_in/calendar/calendar.vue';
import CalendarManagementView from '@/client/components/logged_in/calendar-management/root.vue';
import CalendarGeneralView from '@/client/components/logged_in/calendar-management/settings.vue';
import CalendarEditorsView from '@/client/components/logged_in/calendar-management/editors.vue';
import CalendarReportsView from '@/client/components/logged_in/calendar-management/reports.vue';
import CalendarImportView from '@/client/components/logged_in/calendar-management/import-sources/ImportSourcesSection.vue';
import CalendarWidgetView from '@/client/components/logged_in/calendar-management/widget-tab.vue';
import EditEventView from '@/client/components/logged_in/calendar/edit_event.vue';
import EditPlaceView from '@/client/components/logged_in/calendar/edit-place.vue';
import FeedView from '@/client/components/logged_in/feed/root.vue';
import SettingsRootView from '@/client/components/logged_in/settings/root.vue';
import SettingsListPage from '@/client/components/logged_in/settings/list-page.vue';
import ProfileView from '@/client/components/logged_in/settings/profile.vue';
import SecurityView from '@/client/components/logged_in/settings/security.vue';
import AccountCalendarsView from '@/client/components/logged_in/settings/account-calendars.vue';
import CalendarCategoryMappingsView from '@/client/components/logged_in/settings/calendar-category-mappings.vue';
import InboxView from '@/client/components/logged_in/inbox.vue';
import FundingPlanView from '@/client/components/account/funding-plan.vue';

import AdminViews from '@/client/components/admin/root.vue';
import InvitesListView from '@/client/components/admin/accounts.vue';
import AdminSettingsView from '@/client/components/admin/settings.vue';
import CalendarsDashboardView from '@/client/components/admin/calendars-dashboard.vue';
import FederationSettingsView from '@/client/components/admin/federation.vue';
import FundingSettingsView from '@/client/components/admin/funding.vue';
import ModerationDashboardView from '@/client/components/admin/moderation-dashboard.vue';
import ReportDetailView from '@/client/components/admin/report-detail.vue';
import ModerationSettingsView from '@/client/components/admin/moderation-settings.vue';
import BlockedInstancesView from '@/client/components/admin/blocked-instances.vue';

import type { SettingsGroup } from '@/client/components/logged_in/settings/nav-items';

declare module 'vue-router' {
  interface RouteMeta {
    /** At md+ the main sidebar collapses to an icon-only rail on this subtree (applied by CSS). */
    shellRail?: boolean;
    /** The settings group whose index this record is, read by the list page. */
    settingsGroup?: SettingsGroup;
  }
}

/** The guards the route table needs; app.ts supplies them, tests pass stand-ins. */
export interface ClientRouteDeps {
  mustBeLoggedIn: NavigationGuard;
  mustBeAdmin: NavigationGuard;
  setupGuard: NavigationGuard;
  authRouteGuard: NavigationGuard;
  /** Guard for a bare route: redirect to the current calendar, or to `fallback`. */
  currentCalendarRedirect: (routeName: string, fallback: RouteLocationRaw | true) => NavigationGuard;
  /** Settings index route: render the list page in page mode, else forward to the group's first visible leaf. */
  settingsIndexRedirect: (group: SettingsGroup) => NavigationGuard;
  /** Calendar subtree entry: replace an owner-only leaf the viewer may not see, before commit. */
  calendarLeafGate: NavigationGuard;
  /** Temporary: maps the retired `?tab=reports[&report=]` calendar settings form onto the Reports leaf. */
  legacyTabReportsRedirect: NavigationGuard;
  /** Funding plan leaf: redirect to Profile when instance funding is disabled. */
  fundingEnabledRedirect: NavigationGuard;
}

/** Placeholder component for routes whose guard always redirects. */
const RedirectOnly = { render: () => null };

/**
 * The client SPA route table. Every top-level segment here must be reserved
 * in `src/common/routing/reserved-segments.ts` (DEC-018); a client route needs
 * only that reservation, never a `SERVER_OWNED_SEGMENTS` entry.
 *
 * Bare `/calendar` and `/feed` resolve to the current calendar; bare `/settings`
 * is the settings root list, forwarding to a leaf of it at md+.
 * Old paths (`/profile`, `/funding`, `/admin/*`, `/calendar/:calendar/manage`)
 * have no redirects.
 */
export function buildClientRoutes(deps: ClientRouteDeps): RouteRecordRaw[] {
  const {
    mustBeLoggedIn, mustBeAdmin, setupGuard, authRouteGuard, currentCalendarRedirect,
    settingsIndexRedirect, calendarLeafGate, legacyTabReportsRedirect, fundingEnabledRedirect,
  } = deps;

  const routes: RouteRecordRaw[] = [
    { path: '/', component: AppViews, name: 'app', beforeEnter: mustBeLoggedIn,
      children: [
        // Bare /calendar: the current calendar, or the zero-calendar empty state rendered in place.
        { path: 'calendar', component: NoCalendarsView, name: 'calendars',
          beforeEnter: [mustBeLoggedIn, currentCalendarRedirect('calendar', true)] },
        { path: 'calendar/:calendar', component: CalendarView, name: 'calendar', beforeEnter: mustBeLoggedIn },
        { path: 'inbox', component: InboxView, name: 'inbox', beforeEnter: mustBeLoggedIn },
        { path: 'feed', component: RedirectOnly, name: 'feed_root',
          beforeEnter: [mustBeLoggedIn, currentCalendarRedirect('feed', { name: 'calendars' })] },
        { path: 'feed/:calendar', component: FeedView, name: 'feed', beforeEnter: mustBeLoggedIn },
        {
          path: 'feed/:calendar/following/:actorId/category-mappings',
          component: CalendarCategoryMappingsView,
          name: 'calendar_category_mappings',
          beforeEnter: mustBeLoggedIn,
          props: true,
        },
        // Settings: calendar management, the account, and instance admin.
        { path: 'settings', component: SettingsRootView, beforeEnter: mustBeLoggedIn, meta: { shellRail: true },
          children: [
            // A parent's beforeEnter does not run between siblings, so each child guards itself.
            // The root: the root list below md; at md+ the current calendar's first visible leaf
            // (Profile with no calendars).
            { path: '', component: SettingsListPage, name: 'settings', meta: { settingsGroup: 'root' },
              beforeEnter: [mustBeLoggedIn, settingsIndexRedirect('root')] },
            // Calendar: the parent has no name. Its gate refuses an owner-only leaf on entry;
            // root.vue resolves the calendar and gates moves within the subtree.
            { path: 'calendar/:calendar', component: CalendarManagementView, beforeEnter: [mustBeLoggedIn, calendarLeafGate],
              children: [
                { path: '', component: SettingsListPage, name: 'calendar_management', meta: { settingsGroup: 'calendar' },
                  beforeEnter: [mustBeLoggedIn, legacyTabReportsRedirect, settingsIndexRedirect('calendar')] },
                { path: 'general', component: CalendarGeneralView, name: 'calendar_general', beforeEnter: mustBeLoggedIn },
                { path: 'editors', component: CalendarEditorsView, name: 'calendar_editors', beforeEnter: mustBeLoggedIn },
                { path: 'reports', component: CalendarReportsView, name: 'calendar_reports', beforeEnter: mustBeLoggedIn },
                { path: 'reports/:reportId', component: CalendarReportsView, name: 'calendar_report_detail', beforeEnter: mustBeLoggedIn },
                { path: 'import', component: CalendarImportView, name: 'calendar_import', beforeEnter: mustBeLoggedIn },
                { path: 'widget', component: CalendarWidgetView, name: 'calendar_widget', beforeEnter: mustBeLoggedIn },
              ],
            },
            // Account: the index is a list page below md and forwards to its first leaf at md+.
            { path: 'account', component: SettingsListPage, name: 'account', meta: { settingsGroup: 'account' },
              beforeEnter: [mustBeLoggedIn, settingsIndexRedirect('account')] },
            { path: 'account/profile', component: ProfileView, name: 'profile', beforeEnter: mustBeLoggedIn },
            { path: 'account/security', component: SecurityView, name: 'security', beforeEnter: mustBeLoggedIn },
            { path: 'account/calendars', component: AccountCalendarsView, name: 'account_calendars', beforeEnter: mustBeLoggedIn },
            { path: 'account/funding', component: FundingPlanView, name: 'funding_plan',
              beforeEnter: [mustBeLoggedIn, fundingEnabledRedirect] },
            // Admin: the parent has no name; its index child is the list page below md and
            // forwards to the first admin leaf at md+.
            { path: 'admin', component: AdminViews, beforeEnter: mustBeAdmin,
              children: [
                { path: '', component: SettingsListPage, name: 'admin', meta: { settingsGroup: 'admin' },
                  beforeEnter: [mustBeAdmin, settingsIndexRedirect('admin')] },
                { path: 'settings', component: AdminSettingsView, name: 'admin_settings', beforeEnter: mustBeAdmin },
                { path: 'accounts', component: InvitesListView, name: 'accounts', beforeEnter: mustBeAdmin },
                { path: 'calendars', component: CalendarsDashboardView, name: 'admin_calendars', beforeEnter: mustBeAdmin },
                { path: 'moderation', component: ModerationDashboardView, name: 'moderation', beforeEnter: mustBeAdmin },
                { path: 'moderation/reports/:reportId', component: ReportDetailView, name: 'moderation_report_detail', beforeEnter: mustBeAdmin },
                { path: 'moderation/settings', component: ModerationSettingsView, name: 'moderation_settings', beforeEnter: mustBeAdmin },
                { path: 'moderation/blocked-instances', component: BlockedInstancesView, name: 'blocked_instances', beforeEnter: mustBeAdmin },
                { path: 'federation', component: FederationSettingsView, name: 'federation', beforeEnter: mustBeAdmin },
                { path: 'funding', component: FundingSettingsView, name: 'funding', beforeEnter: mustBeAdmin },
              ],
            },
          ],
        },
      ],
    },
    // Event routes are top-level to render fullscreen without navigation
    { path: '/event', component: EditEventView, name: 'event_new', beforeEnter: mustBeLoggedIn },
    { path: '/event/:eventId', component: EditEventView, name: 'event_edit', beforeEnter: mustBeLoggedIn, props: true },
    // Place routes are top-level to render fullscreen without navigation
    { path: '/calendar/:calendar/places/new', component: EditPlaceView, name: 'place_new', beforeEnter: mustBeLoggedIn },
    { path: '/calendar/:calendar/places/:placeId', component: EditPlaceView, name: 'place_edit', beforeEnter: mustBeLoggedIn, props: (route) => ({ placeId: route.params.placeId }) },
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
        { path: 'apply/confirm/:token', component: ApplyConfirmView, name: 'apply-confirm', props: true, beforeEnter: authRouteGuard },
        { path: 'email/confirm/:token', component: EmailConfirmView, name: 'email-confirm', props: true, beforeEnter: authRouteGuard },
        { path: 'forgot', component: PasswordForgotView, name: 'forgot_password', props: true, beforeEnter: authRouteGuard },
        { path: 'password', component: PasswordResetView, name: 'reset_password', props: true, beforeEnter: authRouteGuard },
      ],
    },
    // Convenience redirect: /login → /auth/login
    { path: '/login', redirect: '/auth/login' },
    // Public instance policy page — anonymous and authenticated visitors both have access.
    // Mounts the AuthViews layout but is intentionally outside the /auth namespace and
    // carries no auth/setup guard at the route level.
    { path: '/policy', component: AuthViews,
      children: [
        { path: '', component: InstancePolicyView, name: 'instance-policy' },
      ],
    },
  ];

  return routes;
}
