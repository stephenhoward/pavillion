import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { RouteLocationNormalized } from 'vue-router';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFundingStore } from '@/client/stores/fundingStore';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar-storage';
import type { SettingsGroup } from '@/client/components/logged_in/settings/nav-items';
import {
  buildSettingsNavContext,
  createSettingsGuards,
  findViewerCalendar,
  isReportId,
  readSettingsNavSources,
  settingsIndexTarget,
  withHistoryMode,
  type SettingsGuardDeps,
} from '@/client/service/settings-guards';

const owned = (id: string, urlName: string) => new CalendarInfo(new Calendar(id, urlName), 'owner');
const edited = (id: string, urlName: string) => new CalendarInfo(new Calendar(id, urlName), 'editor');

const REPORT_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

type Query = Record<string, unknown>;
type Params = Record<string, unknown>;

/** The path every test route is entered at. */
const TO_PATH = '/settings/to';

function route(params: Params = {}, query: Query = {}): RouteLocationNormalized {
  return { params, query, fullPath: TO_PATH } as unknown as RouteLocationNormalized;
}

/** Call a guard directly with only the `to` location the guards read. */
async function run(guard: unknown, to: RouteLocationNormalized): Promise<unknown> {
  return (guard as (to: RouteLocationNormalized, from: RouteLocationNormalized, next: () => void) => unknown)(
    to,
    to,
    () => {},
  );
}

describe('settings guards', () => {
  let infos: CalendarInfo[];
  let sidebar: boolean;
  let admin: boolean;
  let funding: boolean;
  let deps: SettingsGuardDeps & { loadCalendars: ReturnType<typeof vi.fn> };
  /** The history's location: the page being left during a push, TO_PATH on Back/Forward. */
  let historyAt: string;

  beforeEach(() => {
    // setSelectedCalendar persists, and a new store reads the key back.
    localStorage.removeItem(CURRENT_CALENDAR_STORAGE_KEY);
    setActivePinia(createPinia());
    infos = [owned('o1', 'riverside'), edited('e1', 'shared')];
    sidebar = true;
    admin = false;
    funding = true;
    historyAt = '/settings/from';
    deps = {
      loadCalendars: vi.fn(async () => {
        useCalendarStore().setCalendarInfos(infos);
        return infos;
      }),
      isAdmin: () => admin,
      loadInstanceFunding: async () => {
        useFundingStore().setInstanceFundingEnabled(funding);
        return funding;
      },
      treeIsSidebar: () => sidebar,
      historyLocation: () => historyAt,
    };
  });

  describe('settingsIndexRedirect', () => {
    const groups: SettingsGroup[] = ['root', 'calendar', 'account', 'admin'];

    it.each(groups)('renders the list page for %s in page mode without loading anything', async (group) => {
      sidebar = false;
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect(group), route({ calendar: 'riverside' }))).toBe(true);
      expect(deps.loadCalendars).not.toHaveBeenCalled();
    });

    it('forwards root to the current calendar\'s general leaf for an owner', async () => {
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('root'), route())).toEqual({
        name: 'calendar_general', params: { calendar: 'riverside' },
      });
    });

    it('forwards root to the widget leaf when the current calendar is edited', async () => {
      useCalendarStore().setSelectedCalendar('e1');
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('root'), route())).toEqual({
        name: 'calendar_widget', params: { calendar: 'shared' },
      });
    });

    it('forwards root to profile when the viewer has no calendars', async () => {
      infos = [];
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('root'), route())).toEqual({ name: 'profile' });
    });

    it('ignores a stale persisted calendar id in favour of the resolved current calendar', async () => {
      useCalendarStore().setSelectedCalendar('gone');
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('root'), route())).toEqual({
        name: 'calendar_general', params: { calendar: 'riverside' },
      });
    });

    it('forwards a calendar the viewer owns to its general leaf', async () => {
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('calendar'), route({ calendar: 'riverside' }))).toEqual({
        name: 'calendar_general', params: { calendar: 'riverside' },
      });
    });

    it('forwards a calendar the viewer edits to its widget leaf', async () => {
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('calendar'), route({ calendar: 'shared' }))).toEqual({
        name: 'calendar_widget', params: { calendar: 'shared' },
      });
    });

    it.each([
      ['an unknown calendar', 'elsewhere'],
      ['an array param', ['riverside']],
      ['a missing param', undefined],
    ])('does not forward %s', async (_label, calendar) => {
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('calendar'), route({ calendar }))).toBe(true);
    });

    it('leaves the selection untouched for a calendar the viewer cannot resolve', async () => {
      useCalendarStore().setSelectedCalendar('o1');
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      await run(settingsIndexRedirect('calendar'), route({ calendar: 'elsewhere' }));
      expect(useCalendarStore().selectedCalendarId).toBe('o1');
      expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBe('o1');
    });

    it.each(groups)('does not forward %s when the calendar load fails', async (group) => {
      deps.loadCalendars.mockRejectedValue(new Error('offline'));
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect(group), route({ calendar: 'riverside' }))).toBe(true);
    });

    it('forwards account to profile', async () => {
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('account'), route())).toEqual({ name: 'profile' });
    });

    it('forwards admin to the instance general leaf for an admin', async () => {
      admin = true;
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('admin'), route())).toEqual({ name: 'admin_settings' });
    });

    it('uses the calendars the loader brings in on a cold load', async () => {
      expect(useCalendarStore().calendarInfos).toEqual([]);
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      expect(await run(settingsIndexRedirect('calendar'), route({ calendar: 'riverside' }))).toEqual({
        name: 'calendar_general', params: { calendar: 'riverside' },
      });
      expect(deps.loadCalendars).toHaveBeenCalledOnce();
    });
  });

  describe('history mode', () => {
    it('leaves push or replace to the navigation while the page being left is in the address bar', async () => {
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      const result = await run(settingsIndexRedirect('account'), route());
      expect(result).toEqual({ name: 'profile' });
      expect('replace' in (result as object)).toBe(false);
    });

    it.each([
      ['settingsIndexRedirect', (g: ReturnType<typeof createSettingsGuards>) => g.settingsIndexRedirect('account'), route()],
      ['calendarLeafGate', (g: ReturnType<typeof createSettingsGuards>) => g.calendarLeafGate, Object.assign(route({ calendar: 'shared' }), { name: 'calendar_general' })],
      ['fundingEnabledRedirect', (g: ReturnType<typeof createSettingsGuards>) => g.fundingEnabledRedirect, route()],
    ] as const)('%s replaces when the URL it leaves is already in the address bar', async (_name, pick, to) => {
      funding = false;
      historyAt = TO_PATH;
      const result = await run(pick(createSettingsGuards(deps)), to);
      expect(result).toMatchObject({ replace: true });
    });

    it('drops a replace the target carries when the navigation is a push', () => {
      expect(withHistoryMode({ name: 'profile', replace: true }, { fullPath: TO_PATH }, () => '/settings/from'))
        .toEqual({ name: 'profile' });
    });
  });

  describe('settingsIndexTarget', () => {
    it.each<[SettingsGroup, unknown, boolean]>([
      ['root', undefined, false],
      ['calendar', 'riverside', false],
      ['calendar', 'elsewhere', true],
      ['calendar', ['riverside'], true],
      ['account', undefined, false],
    ])('agrees with the guard for %s / %j', async (group, calendar, unresolved) => {
      const target = await settingsIndexTarget(group, calendar, deps);
      const { settingsIndexRedirect } = createSettingsGuards(deps);
      const result = await run(settingsIndexRedirect(group), route({ calendar }));
      expect(target === null).toBe(unresolved);
      expect(result).toEqual(target === null ? true : target);
    });

    it('returns null when the calendar load fails', async () => {
      deps.loadCalendars.mockRejectedValue(new Error('offline'));
      expect(await settingsIndexTarget('root', undefined, deps)).toBeNull();
    });
  });

  describe('readSettingsNavSources', () => {
    it('reads the loaded calendars, selection and funding flag from the stores', () => {
      useCalendarStore().setCalendarInfos(infos);
      useCalendarStore().setSelectedCalendar('e1');
      useFundingStore().setInstanceFundingEnabled(true);
      admin = true;
      expect(readSettingsNavSources(() => admin)).toEqual({
        calendars: infos, selectedCalendarId: 'e1', isAdmin: true, fundingEnabled: true,
      });
    });

    it('reports a funding flag that has not loaded as null', () => {
      expect(readSettingsNavSources(() => false).fundingEnabled).toBeNull();
    });
  });

  describe('findViewerCalendar', () => {
    it('returns the viewer\'s calendar the param names', () => {
      expect(findViewerCalendar('shared', infos)).toBe(infos[1]);
    });

    it.each([
      ['a calendar the viewer does not have', 'elsewhere'],
      ['a repeated param', ['riverside', 'shared']],
      ['no param', undefined],
    ])('returns null for %s', (_case, param) => {
      expect(findViewerCalendar(param, infos)).toBeNull();
    });

    it('returns null before the calendars have loaded', () => {
      expect(findViewerCalendar('riverside', [])).toBeNull();
    });
  });

  describe('buildSettingsNavContext', () => {
    const sources = () => ({ calendars: infos, selectedCalendarId: null, isAdmin: false, fundingEnabled: null });

    it('never builds a context from a calendar param the viewer cannot resolve', () => {
      expect(buildSettingsNavContext('calendar', 'elsewhere', sources())).toBeNull();
    });

    it('reads a not-yet-loaded funding flag as disabled', () => {
      expect(buildSettingsNavContext('account', undefined, sources())?.fundingEnabled).toBe(false);
    });

    it('addresses the current calendar outside the calendar group', () => {
      expect(buildSettingsNavContext('account', undefined, sources())).toEqual({
        calendarUrlName: 'riverside', isOwner: true, isAdmin: false, fundingEnabled: false,
      });
    });
  });

  describe('fundingEnabledRedirect', () => {
    it('redirects to profile when instance funding is disabled', async () => {
      funding = false;
      const { fundingEnabledRedirect } = createSettingsGuards(deps);
      expect(await run(fundingEnabledRedirect, route())).toEqual({ name: 'profile' });
    });

    it('lets the funding plan through when instance funding is enabled', async () => {
      const { fundingEnabledRedirect } = createSettingsGuards(deps);
      expect(await run(fundingEnabledRedirect, route())).toBe(true);
    });
  });

  describe('isReportId', () => {
    it.each<[unknown, boolean]>([
      [REPORT_ID, true],
      [REPORT_ID.toUpperCase(), true],
      ['3f2b8c1e-9a4d-1e6f-8b2a-1c3d5e7f9a0b', false],
      [`${REPORT_ID}/x`, false],
      [[REPORT_ID], false],
      [undefined, false],
    ])('%j → %s', (value, expected) => {
      expect(isReportId(value)).toBe(expected);
    });
  });
});
