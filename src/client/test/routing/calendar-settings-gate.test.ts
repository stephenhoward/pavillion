import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { mountComponent } from '@/client/test/lib/vue';
import { installMatchMedia, type FakeMatchMedia } from '@/client/test/lib/match-media';
import { buildClientRoutes } from '@/client/routes';
import { createRouteGuards } from '@/client/service/route-guards';
import { createSettingsGuards, historyPath } from '@/client/service/settings-guards';
import CalendarService from '@/client/service/calendar';
import FundingService from '@/client/service/funding';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useShellLayout, resetShellLayoutForTesting } from '@/client/composables/useShellLayout';

/*
 * The calendar ownership gate across the real route table, the real settings
 * layout (settings/root.vue, with its page-mode focus rule) and the real
 * calendar-management/root.vue. Leaves, the app shell and Profile are
 * stand-ins, so what is under test is where navigation lands and what the
 * h1 says when the focus rule moves focus to it.
 */

/** A leaf stand-in that renders its own name and nothing else. */
function leaf(name: string) {
  return { default: defineComponent({ name, render: () => h('div', { 'data-leaf': name }) }) };
}

vi.mock('@/client/components/logged_in/root.vue', () => ({
  default: defineComponent({ name: 'AppShell', template: '<RouterView />' }),
}));
vi.mock('@/client/components/logged_in/settings/profile.vue', () => leaf('ProfileLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/settings.vue', () => leaf('GeneralLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/editors.vue', () => leaf('EditorsLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/reports.vue', () => leaf('ReportsLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/import-sources/ImportSourcesSection.vue', () => leaf('ImportLeaf'));
vi.mock('@/client/components/logged_in/calendar-management/widget-tab.vue', () => leaf('WidgetLeaf'));

function calendar(id: string, urlName: string, name: string): Calendar {
  const cal = new Calendar(id, urlName);
  cal.content('en').name = name;
  return cal;
}

describe('calendar settings gate with the settings layout', () => {
  let pinia: Pinia;
  let media: FakeMatchMedia;
  let router: Router;
  let wrapper: VueWrapper | null;
  /** Every element focused, as "TAG:text" at the moment it took focus. */
  let focusLog: string[];

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    const infos = [
      new CalendarInfo(calendar('a1', 'riverside', 'Riverside Arts'), 'owner'),
      new CalendarInfo(calendar('b1', 'shared', 'Shared Events'), 'editor'),
    ];
    vi.spyOn(CalendarService.prototype, 'ensureCalendarsLoaded').mockImplementation(async () => {
      useCalendarStore().setCalendarInfos(infos);
      return infos;
    });
    vi.spyOn(FundingService.prototype, 'ensureInstanceFundingLoaded').mockResolvedValue(false);

    focusLog = [];
    const originalFocus = HTMLElement.prototype.focus;
    vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      focusLog.push(`${this.tagName}:${this.textContent?.trim() ?? ''}`);
      return originalFocus.call(this, options);
    });

    resetShellLayoutForTesting();
    // Page mode: the settings tree is a page, and the focus rule is live.
    media = installMatchMedia(false);

    const session = { isLoggedIn: () => true, isAdmin: () => false };
    router = createRouter({
      history: createMemoryHistory(),
      routes: buildClientRoutes({
        ...createRouteGuards(session, () => false),
        currentCalendarRedirect: () => () => true,
        ...createSettingsGuards({
          loadCalendars: () => new CalendarService().ensureCalendarsLoaded(),
          isAdmin: () => false,
          loadInstanceFunding: () => new FundingService().ensureInstanceFundingLoaded(),
          treeIsSidebar: () => useShellLayout().mainNavIsSidebar.value,
          historyLocation: () => historyPath(router),
        }),
      }),
    });
    wrapper = null;
  });

  afterEach(() => {
    wrapper?.unmount();
    resetShellLayoutForTesting();
    media.restore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  /** Navigates to `path`, mounts the app there, and clears the focus log. */
  async function mountAt(path: string): Promise<VueWrapper> {
    await router.push(path);
    await router.isReady();
    wrapper = mountComponent({ template: '<RouterView />' }, router, { pinia, attachTo: document.body });
    await flushPromises();
    focusLog = [];
    return wrapper;
  }

  async function navigate(path: string): Promise<void> {
    await router.push(path);
    await flushPromises();
  }

  const heading = (w: VueWrapper) => w.find('h1.settings-page-header__title');

  it('keeps an editor on widget with no navigation and no focus move', async () => {
    await mountAt('/settings/calendar/shared/widget');
    const push = vi.spyOn(router.options.history, 'push');
    const replace = vi.spyOn(router.options.history, 'replace');

    await navigate('/settings/calendar/shared/general');

    expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/widget');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(focusLog).toEqual([]);
  });

  it('lands an owner of one calendar on widget of a calendar they only edit', async () => {
    const w = await mountAt('/settings/calendar/riverside/general');
    expect(w.find('[data-leaf="GeneralLeaf"]').exists()).toBe(true);

    await navigate('/settings/calendar/shared/general');

    expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/widget');
    expect(w.find('[data-leaf="WidgetLeaf"]').exists()).toBe(true);
    expect(w.find('[data-leaf="GeneralLeaf"]').exists()).toBe(false);
  });

  it('lands a cold load of a refused leaf on widget before commit, with no focus move', async () => {
    const committed: string[] = [];
    router.afterEach((to, _from, failure) => {
      if (!failure) {
        committed.push(to.fullPath);
      }
    });
    focusLog = [];

    await router.push('/settings/calendar/shared/general');
    await router.isReady();
    wrapper = mountComponent({ template: '<RouterView />' }, router, { pinia, attachTo: document.body });
    await flushPromises();

    expect(committed).toEqual(['/settings/calendar/shared/widget']);
    expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/shared/widget');
    expect(heading(wrapper).text()).toBe('Widget');
    expect(focusLog).toEqual([]);
  });

  it('moves focus once, to an h1 reading Widget, on entry from Profile to a refused leaf', async () => {
    const w = await mountAt('/settings/account/profile');
    const committed: string[] = [];
    router.afterEach((to, _from, failure) => {
      if (!failure) {
        committed.push(to.fullPath);
      }
    });

    await navigate('/settings/calendar/shared/general');

    expect(committed).toEqual(['/settings/calendar/shared/widget']);
    expect(focusLog).toEqual(['H1:Widget']);
    expect(heading(w).text()).toBe('Widget');
  });
});
