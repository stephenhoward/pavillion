import type { NavigationGuard, RouteLocationNamedRaw, RouteLocationNormalized, Router } from 'vue-router';
import type { CalendarInfo } from '@/common/model/calendar_info';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { resolveCurrentCalendar, type CalendarLoader } from '@/client/service/current-calendar';
import {
  findLeafByRouteName,
  firstVisibleLeaf,
  isVisibleLeaf,
  type SettingsGroup,
  type SettingsNavContext,
} from '@/client/components/logged_in/settings/nav-items';

/*
 * The settings route guards, and the one place a SettingsNavContext is built.
 *
 * settingsIndexRedirect is the only viewport-dependent navigation decision in
 * script: an index route renders its list page below md and forwards to the
 * group's first visible leaf at md+. Its target computation,
 * settingsIndexTarget, is shared with list-page.vue's resize watch so the two
 * cannot disagree. Leaf visibility itself lives in nav-items.ts; every
 * consumer (tree, list page, layout, these guards, the calendar owner gate)
 * builds its context with buildSettingsNavContext over readSettingsNavSources,
 * so the tree never shows a leaf a redirect rejects.
 *
 * calendarLeafGate refuses an owner-only calendar leaf before the
 * navigation commits, so the page header (and the focus rule that reads it)
 * never shows the refused leaf. calendar-management/root.vue applies the
 * same calendarLeafRedirect to moves within its subtree and to ownership
 * lost while mounted.
 *
 * A guard redirect never adds a history entry and never erases the page the
 * viewer came from: it inherits the navigation's push or replace, and
 * replaces only when the URL it redirects away from is already in the
 * address bar (Back/Forward, a first load). withHistoryMode is that one
 * form. Every target is a fixed named route: no URL input is echoed into
 * one. See DEC-021, client settings information
 * architecture (agent-os/product/decisions/dec-021-client-settings-information-architecture.md).
 */

/**
 * Strict UUID v4 shape, kept identical to the server's isValidUuidV4 so
 * client and server agree on what counts as malformed.
 */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Whether a route or query value is a single, well-formed report id. */
export function isReportId(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

/** The viewer's loaded data a SettingsNavContext is derived from. */
export interface SettingsNavSources {
  /** The viewer's own calendars (owned and edited). */
  calendars: CalendarInfo[];
  /** The persisted selection; validated against `calendars`, never trusted. */
  selectedCalendarId: string | null;
  isAdmin: boolean;
  /** The cached instance funding flag; null (not yet loaded) reads as disabled. */
  fundingEnabled: boolean | null;
}

/**
 * Read the viewer's loaded settings data from the calendar and funding
 * stores. Every consumer passes this to buildSettingsNavContext rather than
 * assembling the sources itself.
 *
 * Reactive-safe inside a computed(): it reads store state directly, so the
 * computed re-evaluates when the calendars, the selection or the funding
 * flag change. It loads nothing. A null funding flag means "not loaded yet"
 * and is read as disabled, so a component must call
 * FundingService.ensureInstanceFundingLoaded() itself (and the calendar
 * loader likewise) for the context to reach its final value.
 */
export function readSettingsNavSources(isAdmin: () => boolean): SettingsNavSources {
  const calendarStore = useCalendarStore();
  return {
    calendars: calendarStore.calendarInfos,
    selectedCalendarId: calendarStore.selectedCalendarId,
    isAdmin: isAdmin(),
    fundingEnabled: useFundingStore().instanceFundingEnabled,
  };
}

/**
 * The viewer's own calendar a route's `:calendar` param names, or null when
 * the param is not a single string naming one of `calendars`. Null is the
 * unresolved calendar: nonexistent, not a member, or not loaded yet. The one
 * definition of it, shared by buildSettingsNavContext and the settings page
 * header, so the header's unresolved state and the guards' cannot disagree.
 */
export function findViewerCalendar(calendarParam: unknown, calendars: CalendarInfo[]): CalendarInfo | null {
  if (typeof calendarParam !== 'string') {
    return null;
  }
  return calendars.find((candidate) => candidate.calendar.urlName === calendarParam) ?? null;
}

/**
 * Build the context the settings tree is evaluated against. The calendar
 * group addresses the route's `:calendar`, looked up in the viewer's own
 * list; every other group addresses the current calendar from
 * resolveCurrentCalendar. Returns null when the calendar group's param is not
 * a single string naming one of the viewer's calendars: an unresolved
 * calendar gets no context, so nothing is built from the param alone.
 */
export function buildSettingsNavContext(
  group: SettingsGroup,
  calendarParam: unknown,
  sources: SettingsNavSources,
): SettingsNavContext | null {
  let info: CalendarInfo | null;
  if (group === 'calendar') {
    info = findViewerCalendar(calendarParam, sources.calendars);
    if (!info) {
      return null;
    }
  }
  else {
    info = resolveCurrentCalendar(sources.selectedCalendarId, sources.calendars);
  }
  return {
    calendarUrlName: info?.calendar.urlName ?? null,
    isOwner: info?.isOwner ?? false,
    isAdmin: sources.isAdmin,
    fundingEnabled: sources.fundingEnabled === true,
  };
}

/**
 * The owner-only calendar gate: where a route must go instead, or null to
 * let it through. Only calendar leaves (and their sub-routes) are gated: the
 * index is not a leaf, a route outside the calendar group is never
 * redirected, and an unresolved calendar (null context) gets no forward, so
 * its empty state stays non-disclosing.
 */
export function calendarLeafRedirect(name: unknown, ctx: SettingsNavContext | null): RouteLocationNamedRaw | null {
  if (!ctx || typeof name !== 'string' || findLeafByRouteName(name)?.group !== 'calendar') {
    return null;
  }
  return isVisibleLeaf('calendar', name, ctx) ? null : firstVisibleLeaf('calendar', ctx);
}

/**
 * The history's current location as a resolved fullPath, so it compares
 * equal to a route's fullPath whatever its encoding; '' before the first
 * navigation of a memory history. During a push it is still the URL being
 * left; during Back/Forward and a first load it is already the URL being
 * entered.
 */
export function historyPath(router: Router): string {
  const location = router.options.history.location;
  return location ? router.resolve(location).fullPath : '';
}

/**
 * A guard redirect to `target` in the one history form: replace when `to`
 * is already the history's location (Back/Forward, a first load), so the
 * redirect neither adds an entry nor leaves one that forwards again;
 * otherwise no `replace` key, so the navigation's own push or replace
 * carries through and the page the viewer came from survives.
 */
export function withHistoryMode(
  target: RouteLocationNamedRaw,
  to: Pick<RouteLocationNormalized, 'fullPath'>,
  historyLocation: () => string,
): RouteLocationNamedRaw {
  const { replace: _ignored, ...location } = target;
  return historyLocation() === to.fullPath ? { ...location, replace: true } : location;
}

/** What the index forward needs to load the viewer's context. */
export interface SettingsForwardDeps {
  /** Loads the viewer's calendars into the calendar store. */
  loadCalendars: CalendarLoader;
  isAdmin: () => boolean;
  /** Loads the instance funding flag into the funding store; never rejects. */
  loadInstanceFunding: () => Promise<boolean>;
}

export interface SettingsGuardDeps extends SettingsForwardDeps {
  /** Whether the settings tree is a sidebar (md+) rather than a page. */
  treeIsSidebar: () => boolean;
  /** The history's current location, as {@link historyPath} reads it. */
  historyLocation: () => string;
}

/**
 * The one index-forward target computation: the group's first visible leaf
 * for the viewer, or null for no forward. Loads the viewer's calendars and
 * the funding flag into their stores first, so a cold load decides on
 * loaded data. A failed
 * calendar load, or a calendar the viewer cannot resolve, is null — never
 * the Profile fallback, which only guards against an empty group.
 */
export async function settingsIndexTarget(
  group: SettingsGroup,
  calendarParam: unknown,
  deps: SettingsForwardDeps,
): Promise<RouteLocationNamedRaw | null> {
  try {
    await deps.loadCalendars();
  }
  catch {
    return null;
  }
  await deps.loadInstanceFunding();
  const ctx = buildSettingsNavContext(group, calendarParam, readSettingsNavSources(deps.isAdmin));
  return ctx ? firstVisibleLeaf(group, ctx) : null;
}

export interface SettingsGuards {
  settingsIndexRedirect: (group: SettingsGroup) => NavigationGuard;
  calendarLeafGate: NavigationGuard;
  legacyTabReportsRedirect: NavigationGuard;
  fundingEnabledRedirect: NavigationGuard;
}

/**
 * The settings route guards. Stores and services are read only inside guard
 * bodies, because app.ts builds the route table before Pinia is installed.
 */
export function createSettingsGuards(deps: SettingsGuardDeps): SettingsGuards {
  const redirect = (target: RouteLocationNamedRaw, to: RouteLocationNormalized) =>
    withHistoryMode(target, to, deps.historyLocation);

  return {
    /**
     * An index route: render the list page in page mode, else forward to the
     * group's first visible leaf. The selection is not persisted here; the
     * global current-calendar sync does that on the forwarded navigation.
     */
    settingsIndexRedirect: (group) => async (to) => {
      if (!deps.treeIsSidebar()) {
        return true;
      }
      const target = await settingsIndexTarget(group, to.params.calendar, deps);
      return target ? redirect(target, to) : true;
    },

    /**
     * Entering a calendar's subtree: replace an owner-only leaf the viewer
     * may not see with the group's first visible leaf, before the navigation
     * commits. Loads the viewer's calendars and the funding flag first. A
     * failed load or an unresolved calendar passes, so the pane's error or
     * empty state renders at the unchanged URL; the index always passes.
     */
    calendarLeafGate: async (to) => {
      try {
        await deps.loadCalendars();
      }
      catch {
        return true;
      }
      await deps.loadInstanceFunding();
      const ctx = buildSettingsNavContext('calendar', to.params.calendar, readSettingsNavSources(deps.isAdmin));
      const target = calendarLeafRedirect(to.name, ctx);
      return target ? redirect(target, to) : true;
    },

    /**
     * Temporary: maps the retired `?tab=reports[&report=<uuid>]` form, which
     * sent moderation emails still hold, onto the Reports leaf. Any other tab
     * value is ignored. Targets are built from fixed literals, never from the
     * query. Remove with pv-y5xy once those emails have aged out.
     */
    legacyTabReportsRedirect: (to) => {
      const { tab, report } = to.query;
      const calendar = to.params.calendar;
      if (typeof tab !== 'string' || tab !== 'reports' || typeof calendar !== 'string') {
        return true;
      }
      if (isReportId(report)) {
        return redirect({ name: 'calendar_report_detail', params: { calendar, reportId: report } }, to);
      }
      return redirect({ name: 'calendar_reports', params: { calendar } }, to);
    },

    /** The funding plan leaf: redirect to Profile when the tree hides it. */
    fundingEnabledRedirect: async (to) => {
      await deps.loadInstanceFunding();
      const ctx = buildSettingsNavContext('account', undefined, readSettingsNavSources(deps.isAdmin));
      return ctx && isVisibleLeaf('account', 'funding_plan', ctx)
        ? true
        : redirect({ name: 'profile' }, to);
    },
  };
}
