import type { NavigationGuard, RouteLocationNamedRaw } from 'vue-router';
import type { CalendarInfo } from '@/common/model/calendar_info';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { resolveCurrentCalendar, type CalendarLoader } from '@/client/service/current-calendar';
import {
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
 * builds its context with buildSettingsNavContext so the tree never shows a
 * leaf a redirect rejects.
 *
 * Every redirect replaces, and every target is a fixed named route: no URL
 * input is echoed into one. See DEC-021, client settings information
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
    if (typeof calendarParam !== 'string') {
      return null;
    }
    info = sources.calendars.find((candidate) => candidate.calendar.urlName === calendarParam) ?? null;
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

/** What the index forward needs to load the viewer's context. */
export interface SettingsForwardDeps {
  loadCalendars: CalendarLoader;
  isAdmin: () => boolean;
  /** Resolves the cached instance funding flag; never rejects. */
  loadInstanceFunding: () => Promise<boolean>;
}

export interface SettingsGuardDeps extends SettingsForwardDeps {
  /** Whether the settings tree is a sidebar (md+) rather than a page. */
  treeIsSidebar: () => boolean;
}

/**
 * The one index-forward target computation: the group's first visible leaf
 * for the viewer, or null for no forward. Loads the viewer's calendars and
 * the funding flag first, so a cold load decides on loaded data. A failed
 * calendar load, or a calendar the viewer cannot resolve, is null — never
 * the Profile fallback, which only guards against an empty group.
 */
export async function settingsIndexTarget(
  group: SettingsGroup,
  calendarParam: unknown,
  deps: SettingsForwardDeps,
): Promise<RouteLocationNamedRaw | null> {
  let calendars: CalendarInfo[];
  try {
    calendars = await deps.loadCalendars();
  }
  catch {
    return null;
  }
  const fundingEnabled = await deps.loadInstanceFunding();
  const ctx = buildSettingsNavContext(group, calendarParam, {
    calendars,
    selectedCalendarId: useCalendarStore().selectedCalendarId,
    isAdmin: deps.isAdmin(),
    fundingEnabled,
  });
  return ctx ? firstVisibleLeaf(group, ctx) : null;
}

export interface SettingsGuards {
  settingsIndexRedirect: (group: SettingsGroup) => NavigationGuard;
  legacyTabReportsRedirect: NavigationGuard;
  fundingEnabledRedirect: NavigationGuard;
}

/**
 * The settings route guards. Stores and services are read only inside guard
 * bodies, because app.ts builds the route table before Pinia is installed.
 */
export function createSettingsGuards(deps: SettingsGuardDeps): SettingsGuards {
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
      return target ? { ...target, replace: true } : true;
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
        return { name: 'calendar_report_detail', params: { calendar, reportId: report }, replace: true };
      }
      return { name: 'calendar_reports', params: { calendar }, replace: true };
    },

    /** The funding plan leaf: redirect to Profile when the tree hides it. */
    fundingEnabledRedirect: async () => {
      const fundingEnabled = await deps.loadInstanceFunding();
      const store = useCalendarStore();
      const ctx = buildSettingsNavContext('account', undefined, {
        calendars: store.calendarInfos,
        selectedCalendarId: store.selectedCalendarId,
        isAdmin: deps.isAdmin(),
        fundingEnabled,
      });
      return ctx && isVisibleLeaf('account', 'funding_plan', ctx)
        ? true
        : { name: 'profile', replace: true };
    },
  };
}
