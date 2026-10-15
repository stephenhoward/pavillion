import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import Root from '@/client/components/logged_in/root.vue';
import CalendarService from '@/client/service/calendar';
import NotificationService from '@/client/service/notification';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar-storage';

const Stub = { template: '<div />' };

/** Renders the shell's navigation items as plain links so their targets can be asserted. */
const AppShellStub = {
  props: ['navigationItems'],
  template: '<div><a v-for="item in navigationItems" :key="item.id" :data-nav-id="item.id" :href="item.to">{{ item.label }}</a><slot /></div>',
};

type RootVm = { newEvent: () => Promise<void> };

describe('logged-in root', () => {
  let sandbox: sinon.SinonSandbox;
  let pinia: Pinia;
  let router: Router;
  let wrapper: VueWrapper | null;

  beforeEach(async () => {
    localStorage.removeItem(CURRENT_CALENDAR_STORAGE_KEY);
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox.stub(NotificationService.prototype, 'getNotifications').resolves([]);
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Stub, name: 'app' },
        { path: '/calendar', component: Stub, name: 'calendars' },
        { path: '/event', component: Stub, name: 'event_new' },
      ],
    });
    await router.push('/');
    wrapper = null;
  });

  afterEach(() => {
    // Unmounting stops the notification polling interval.
    wrapper?.unmount();
    sandbox.restore();
    localStorage.removeItem(CURRENT_CALENDAR_STORAGE_KEY);
  });

  const mountRoot = () => {
    wrapper = mountComponent(Root, router, { pinia, stubs: { AppShell: AppShellStub, RouterView: true } });
    return wrapper;
  };

  /** Stub the calendar load to fill the store, as the real service does. */
  const stubCalendars = (infos: CalendarInfo[]) => {
    sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded').callsFake(async () => {
      useCalendarStore().setCalendarInfos(infos);
      return infos;
    });
  };

  describe('navigation', () => {
    it('links the Settings item to /settings', () => {
      const settings = mountRoot().find('[data-nav-id="settings"]');
      expect(settings.attributes('href')).toBe('/settings');
      expect(settings.text()).toBe('Settings');
    });
  });

  describe('newEvent', () => {
    it('goes to /event for the current calendar', async () => {
      stubCalendars([
        new CalendarInfo(new Calendar('o1', 'first'), 'owner'),
        new CalendarInfo(new Calendar('o2', 'second'), 'owner'),
      ]);
      useCalendarStore().selectedCalendarId = 'o2';

      await (mountRoot().vm as unknown as RootVm).newEvent();
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('event_new');
      expect(useCalendarStore().selectedCalendarId).toBe('o2');
    });

    it('falls back to the first owned calendar when the current one is gone', async () => {
      stubCalendars([
        new CalendarInfo(new Calendar('e1', 'edited'), 'editor'),
        new CalendarInfo(new Calendar('o1', 'first'), 'owner'),
      ]);
      useCalendarStore().selectedCalendarId = 'deleted-id';

      await (mountRoot().vm as unknown as RootVm).newEvent();
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('event_new');
      expect(useCalendarStore().selectedCalendarId).toBe('o1');
    });

    it('goes to /calendar with no calendars', async () => {
      stubCalendars([]);

      await (mountRoot().vm as unknown as RootVm).newEvent();
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('calendars');
    });

    it('stays put without throwing when the calendars fail to load', async () => {
      sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded').rejects(new Error('network'));
      sandbox.stub(console, 'error');

      await expect((mountRoot().vm as unknown as RootVm).newEvent()).resolves.toBeUndefined();
      await flushPromises();

      expect(router.currentRoute.value.name).toBe('app');
    });

    it('opens no calendar selector modal', async () => {
      stubCalendars([
        new CalendarInfo(new Calendar('o1', 'first'), 'owner'),
        new CalendarInfo(new Calendar('o2', 'second'), 'owner'),
      ]);
      const root = mountRoot();

      await (root.vm as unknown as RootVm).newEvent();
      await flushPromises();

      expect(root.find('dialog').exists()).toBe(false);
    });
  });
});
