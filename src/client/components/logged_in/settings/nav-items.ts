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

/** A group other than the root: the groups that have leaves of their own. */
export type SettingsLeafGroup = Exclude<SettingsGroup, 'root'>;

/** Whether a value (route meta, a param) names a group with leaves of its own. */
export function isSettingsLeafGroup(value: unknown): value is SettingsLeafGroup {
  return value === 'calendar' || value === 'account' || value === 'admin';
}

/** Each group's title, a key in the `settings` namespace. */
export const SETTINGS_GROUP_TITLE_KEYS: Readonly<Record<SettingsLeafGroup, string>> = {
  calendar: 'titles.calendar',
  account: 'titles.account',
  admin: 'titles.instance',
};

/** The route name of each group's index (its list page). */
export const SETTINGS_GROUP_INDEX_ROUTES: Readonly<Record<SettingsLeafGroup, string>> = {
  calendar: 'calendar_management',
  account: 'account',
  admin: 'admin',
};

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
  /** A tag, not a setting: marks the destructive action row, which the list renders in the danger style. */
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
    items.push(link('calendar', SETTINGS_GROUP_INDEX_ROUTES.calendar, 'nav.root.calendar', Calendar, {
      calendar: ctx.calendarUrlName,
    }));
  }
  items.push(link('account', SETTINGS_GROUP_INDEX_ROUTES.account, 'nav.root.account', User));
  if (ctx.isAdmin) {
    items.push(link('instance', SETTINGS_GROUP_INDEX_ROUTES.admin, 'nav.root.instance', Server));
  }
  items.push({ id: 'logout', labelKey: 'nav.root.log_out', icon: LogOut, action: 'logout', danger: true });
  return items;
}

/** A leaf of the calendar, account or admin group, before any visibility rule. */
interface LeafDefinition {
  id: string;
  routeName: string;
  labelKey: string;
  icon: Component;
  /** Listed only for the calendar's owner. */
  ownerOnly?: boolean;
  /** Listed only when the instance has funding enabled. */
  fundingOnly?: boolean;
  subRoutes?: readonly string[];
}

const CALENDAR_LEAVES: readonly LeafDefinition[] = [
  { id: 'general', routeName: 'calendar_general', labelKey: 'nav.calendar.general', icon: Settings, ownerOnly: true },
  { id: 'editors', routeName: 'calendar_editors', labelKey: 'nav.calendar.editors', icon: Users },
  {
    id: 'reports', routeName: 'calendar_reports', labelKey: 'nav.calendar.reports', icon: ShieldCheck, ownerOnly: true,
    subRoutes: ['calendar_report_detail'],
  },
  { id: 'import', routeName: 'calendar_import', labelKey: 'nav.calendar.import', icon: Download, ownerOnly: true },
  { id: 'widget', routeName: 'calendar_widget', labelKey: 'nav.calendar.widget', icon: LayoutTemplate },
];

const ACCOUNT_LEAVES: readonly LeafDefinition[] = [
  { id: 'profile', routeName: 'profile', labelKey: 'nav.account.profile', icon: User },
  { id: 'security', routeName: 'security', labelKey: 'nav.account.security', icon: Shield },
  { id: 'funding_plan', routeName: 'funding_plan', labelKey: 'nav.account.funding_plan', icon: Sprout, fundingOnly: true },
];

const ADMIN_LEAVES: readonly LeafDefinition[] = [
  { id: 'general', routeName: 'admin_settings', labelKey: 'nav.admin.general', icon: Settings },
  { id: 'accounts', routeName: 'accounts', labelKey: 'nav.admin.accounts', icon: Users },
  { id: 'calendars', routeName: 'admin_calendars', labelKey: 'nav.admin.calendars', icon: Calendar },
  {
    id: 'moderation', routeName: 'moderation', labelKey: 'nav.admin.moderation', icon: ShieldCheck,
    subRoutes: ['moderation_report_detail', 'moderation_settings', 'blocked_instances'],
  },
  { id: 'federation', routeName: 'federation', labelKey: 'nav.admin.federation', icon: Globe },
  { id: 'funding', routeName: 'funding', labelKey: 'nav.admin.funding', icon: Sprout },
];

function toLink(leaf: LeafDefinition, params?: Record<string, string>): SettingsNavLinkItem {
  return link(leaf.id, leaf.routeName, leaf.labelKey, leaf.icon, params, leaf.subRoutes);
}

export function calendarItems(ctx: SettingsNavContext): SettingsNavLinkItem[] {
  const calendar = ctx.calendarUrlName;
  if (!calendar) {
    return [];
  }
  return CALENDAR_LEAVES
    .filter((leaf) => ctx.isOwner || !leaf.ownerOnly)
    .map((leaf) => toLink(leaf, { calendar }));
}

export function accountItems(ctx: SettingsNavContext): SettingsNavLinkItem[] {
  return ACCOUNT_LEAVES
    .filter((leaf) => ctx.fundingEnabled || !leaf.fundingOnly)
    .map((leaf) => toLink(leaf));
}

export function adminItems(): SettingsNavLinkItem[] {
  return ADMIN_LEAVES.map((leaf) => toLink(leaf));
}

/** Which leaf a route belongs to, independent of any viewer. */
export interface SettingsLeafRef {
  group: SettingsLeafGroup;
  /** The leaf's own route name; a sub-route resolves to its parent leaf's. */
  routeName: string;
  labelKey: string;
}

const LEAVES_BY_GROUP: ReadonlyArray<[SettingsLeafGroup, readonly LeafDefinition[]]> = [
  ['calendar', CALENDAR_LEAVES],
  ['account', ACCOUNT_LEAVES],
  ['admin', ADMIN_LEAVES],
];

/**
 * The leaf a route name belongs to, searched across every leaf whatever the
 * viewer may see: a title or a parent link is not visibility, which stays
 * with {@link isVisibleLeaf}. A sub-route resolves to its parent leaf; a name
 * outside the tree (an index route, or no settings route at all) is null.
 */
export function findLeafByRouteName(routeName: string): SettingsLeafRef | null {
  for (const [group, leaves] of LEAVES_BY_GROUP) {
    const leaf = leaves.find(
      (candidate) => candidate.routeName === routeName || (candidate.subRoutes?.includes(routeName) ?? false),
    );
    if (leaf) {
      return { group, routeName: leaf.routeName, labelKey: leaf.labelKey };
    }
  }
  return null;
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
