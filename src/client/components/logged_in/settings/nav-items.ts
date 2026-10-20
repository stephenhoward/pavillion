/**
 * The settings tree: which rows each settings list shows and which leaf an
 * index route lands on. Every function here is pure over the viewer's
 * {@link SettingsNavContext}; labels stay as keys in the `settings`
 * namespace for the renderer to translate.
 *
 * - **One source of leaf visibility.** The tree, the index forward, the
 *   resize watch, the owner-only redirect and the funding-disabled redirect
 *   all read {@link firstVisibleLeaf} and {@link isVisibleLeaf}. Hiding a leaf
 *   is a convenience, not access control: the server endpoints each leaf
 *   calls remain the enforcement point.
 * - **Index routes forward on desktop.** `/settings`, `/settings/calendar/:calendar`,
 *   `/settings/account` and `/settings/admin` render their list page below
 *   md and forward to the group's first visible leaf at md+. So every URL
 *   emitted outside the SPA (server emails, the Stripe return, notification
 *   targets) addresses a leaf, never an index.
 * - **Profile is a loop guard, not an answer.** An empty group forwards to
 *   Profile so no forward can loop. A calendar the viewer cannot resolve
 *   (not in their loaded list, or the load failed) is not an empty group:
 *   callers short-circuit it before asking for a leaf, so it gets no forward
 *   and the same URL with the empty state at either viewport, which keeps
 *   non-member and nonexistent calendars non-disclosing.
 * - **The legacy `?tab=reports` redirect is temporary.** It maps only
 *   `tab=reports` onto the Reports leaf because sent moderation emails hold
 *   that form, and is removed once those emails have aged out.
 *
 * These rules are recorded in DEC-021, client settings information
 * architecture (agent-os/product/decisions/dec-021-client-settings-information-architecture.md).
 */
import type { Component } from 'vue';
import type { RouteLocationNamedRaw } from 'vue-router';
import {
  Calendar,
  Download,
  Globe,
  LayoutTemplate,
  LogOut,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sprout,
  User,
  Users,
} from 'lucide-vue-next';

export type SettingsGroup = 'root' | 'calendar' | 'account' | 'admin';

export interface SettingsNavContext {
  /** The calendar the tree addresses; null when the viewer has none. */
  calendarUrlName: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  fundingEnabled: boolean;
}

export type SettingsNavLinkItem = {
  id: string;
  routeName: string;
  labelKey: string;
  icon: Component;
  to: RouteLocationNamedRaw;
  /** Route names under this leaf that count as the leaf for visibility. */
  subRoutes?: readonly string[];
  action?: never;
  danger?: never;
};

export type SettingsNavActionItem = {
  id: string;
  labelKey: string;
  icon: Component;
  action: 'logout';
  danger: true;
};

export type SettingsNavItem = SettingsNavLinkItem | SettingsNavActionItem;

function link(
  id: string,
  routeName: string,
  labelKey: string,
  icon: Component,
  params?: Record<string, string>,
  subRoutes?: readonly string[],
): SettingsNavLinkItem {
  const item: SettingsNavLinkItem = {
    id,
    routeName,
    labelKey,
    icon,
    to: params ? { name: routeName, params } : { name: routeName },
  };
  if (subRoutes) {
    item.subRoutes = subRoutes;
  }
  return item;
}

export function rootItems(ctx: SettingsNavContext): SettingsNavItem[] {
  const items: SettingsNavItem[] = [];
  if (ctx.calendarUrlName) {
    items.push(link('calendar', 'calendar_management', 'nav.root.calendar', Calendar, {
      calendar: ctx.calendarUrlName,
    }));
  }
  items.push(link('account', 'account', 'nav.root.account', User));
  if (ctx.isAdmin) {
    items.push(link('instance', 'admin', 'nav.root.instance', Server));
  }
  items.push({ id: 'logout', labelKey: 'nav.root.log_out', icon: LogOut, action: 'logout', danger: true });
  return items;
}

export function calendarItems(ctx: SettingsNavContext): SettingsNavLinkItem[] {
  const calendar = ctx.calendarUrlName;
  if (!calendar) {
    return [];
  }
  const params = () => ({ calendar });
  return [
    ctx.isOwner && link('general', 'calendar_general', 'nav.calendar.general', Settings, params()),
    link('editors', 'calendar_editors', 'nav.calendar.editors', Users, params()),
    ctx.isOwner && link('reports', 'calendar_reports', 'nav.calendar.reports', ShieldCheck, params(), [
      'calendar_report_detail',
    ]),
    ctx.isOwner && link('import', 'calendar_import', 'nav.calendar.import', Download, params()),
    link('widget', 'calendar_widget', 'nav.calendar.widget', LayoutTemplate, params()),
  ].filter((item): item is SettingsNavLinkItem => Boolean(item));
}

export function accountItems(ctx: SettingsNavContext): SettingsNavLinkItem[] {
  const items = [
    link('profile', 'profile', 'nav.account.profile', User),
    link('security', 'security', 'nav.account.security', Shield),
  ];
  if (ctx.fundingEnabled) {
    items.push(link('funding_plan', 'funding_plan', 'nav.account.funding_plan', Sprout));
  }
  return items;
}

export function adminItems(): SettingsNavLinkItem[] {
  return [
    link('general', 'admin_settings', 'nav.admin.general', Settings),
    link('accounts', 'accounts', 'nav.admin.accounts', Users),
    link('calendars', 'admin_calendars', 'nav.admin.calendars', Calendar),
    link('moderation', 'moderation', 'nav.admin.moderation', ShieldCheck, undefined, [
      'moderation_report_detail',
      'moderation_settings',
      'blocked_instances',
    ]),
    link('federation', 'federation', 'nav.admin.federation', Globe),
    link('funding', 'funding', 'nav.admin.funding', Sprout),
  ];
}

/** The leaves a group's index can land on, in tree order. */
function leavesOf(group: SettingsGroup, ctx: SettingsNavContext): SettingsNavLinkItem[] {
  switch (group) {
    case 'calendar':
      return calendarItems(ctx);
    case 'account':
      return accountItems(ctx);
    case 'admin':
      return ctx.isAdmin ? adminItems() : [];
    case 'root':
      return [...calendarItems(ctx), ...accountItems(ctx)];
  }
}

/**
 * Where a group's index forwards at md+. Profile is visible to every
 * signed-in viewer, so it is the fallback for an empty group and no forward
 * can loop. Callers must short-circuit an unresolved calendar (not in the
 * viewer's loaded list, or the load failed) before calling: it gets no
 * forward, so non-member and nonexistent calendars stay non-disclosing, and
 * the Profile fallback is never its answer. Each call returns a fresh
 * location the caller may extend.
 */
export function firstVisibleLeaf(group: SettingsGroup, ctx: SettingsNavContext): RouteLocationNamedRaw {
  const [first] = leavesOf(group, ctx);
  return first ? first.to : { name: 'profile' };
}

/** Whether a route name is one of the group's visible leaves or their sub-routes. */
export function isVisibleLeaf(group: SettingsGroup, routeName: string, ctx: SettingsNavContext): boolean {
  return leavesOf(group, ctx).some(
    (item) => item.routeName === routeName || (item.subRoutes?.includes(routeName) ?? false),
  );
}
