import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { createCurrentCalendarRedirect, createCurrentCalendarSync } from '@/client/service/current-calendar';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar-storage';

const owned = (id: string, name: string) => new CalendarInfo(new Calendar(id, name), 'owner');
const Stub = { template: '<div />' };

describe('current calendar route guards', () => {
  let router: Router;
  let infos: CalendarInfo[];
  let loggedIn: boolean;

  function load() {
    const store = useCalendarStore();
    return new Promise<CalendarInfo[]>((resolve) => {
      setTimeout(() => {
        store.setCalendarInfos(infos);
        resolve(infos);
      }, 5);
    });
  }

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    infos = [owned('o1', 'first'), owned('o2', 'second')];
    loggedIn = true;

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Stub, name: 'home' },
        { path: '/auth/login', component: Stub, name: 'login' },
        { path: '/calendar', component: Stub, name: 'calendars',
          beforeEnter: createCurrentCalendarRedirect('calendar', true, load) },
        { path: '/calendar/:calendar', component: Stub, name: 'calendar' },
        { path: '/feed', component: Stub, name: 'feed_root',
          beforeEnter: createCurrentCalendarRedirect('feed', { name: 'calendars' }, load) },
        { path: '/feed/:calendar', component: Stub, name: 'feed' },
        { path: '/settings', component: Stub, name: 'settings',
          beforeEnter: createCurrentCalendarRedirect('calendar_management', { name: 'profile' }, load) },
        { path: '/settings/calendar/:calendar', component: Stub, name: 'calendar_management' },
        { path: '/settings/account/profile', component: Stub, name: 'profile' },
      ],
    });
    router.beforeEach(createCurrentCalendarSync(() => loggedIn, load));
  });

  afterEach(() => localStorage.clear());

  it('entering /calendar/:name sets and persists the selection', async () => {
    await router.push('/calendar/second');
    expect(useCalendarStore().selectedCalendarId).toBe('o2');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBe('o2');
  });

  it('a bare route redirects only after the load resolves', async () => {
    await router.push('/calendar');
    expect(router.currentRoute.value.fullPath).toBe('/calendar/first');
  });

  it('honours a persisted id that is still in the list', async () => {
    useCalendarStore().selectedCalendarId = 'o2';
    await router.push('/feed');
    expect(router.currentRoute.value.fullPath).toBe('/feed/second');
  });

  it('overwrites a stale persisted id', async () => {
    useCalendarStore().selectedCalendarId = 'gone';
    await router.push('/settings');
    expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/first');
    expect(useCalendarStore().selectedCalendarId).toBe('o1');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBe('o1');
  });

  it('null resolution renders /calendar in place and sends /feed and /settings to their fallbacks', async () => {
    infos = [];
    await router.push('/calendar');
    expect(router.currentRoute.value.name).toBe('calendars');
    await router.push('/feed');
    expect(router.currentRoute.value.name).toBe('calendars');
    await router.push('/settings');
    expect(router.currentRoute.value.name).toBe('profile');
  });

  it('an unknown name leaves the selection untouched', async () => {
    useCalendarStore().selectedCalendarId = 'o1';
    await router.push('/calendar/new');
    expect(router.currentRoute.value.name).toBe('calendar');
    expect(useCalendarStore().selectedCalendarId).toBe('o1');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBeNull();
  });

  it('does not load when logged out', async () => {
    loggedIn = false;
    await router.push('/calendar/first');
    expect(useCalendarStore().loaded).toBe(false);
  });

  it('ignores a non-string calendar param', async () => {
    router.addRoute({ path: '/odd/:calendar+', component: Stub, name: 'odd' });
    await router.push('/odd/a/b');
    expect(useCalendarStore().selectedCalendarId).toBeNull();
    expect(useCalendarStore().loaded).toBe(false);
  });

  it('lets the navigation proceed with the selection unchanged when the sync load fails', async () => {
    const failing = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/calendar/:calendar', component: Stub, name: 'calendar' }],
    });
    failing.beforeEach(createCurrentCalendarSync(() => true, () => Promise.reject(new Error('network'))));
    useCalendarStore().selectedCalendarId = 'o1';

    await failing.push('/calendar/second');

    expect(failing.currentRoute.value.fullPath).toBe('/calendar/second');
    expect(useCalendarStore().selectedCalendarId).toBe('o1');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBeNull();
  });

  it('aborts the navigation when the redirect load fails', async () => {
    const failing = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Stub, name: 'home' },
        { path: '/calendar', component: Stub, name: 'calendars',
          beforeEnter: createCurrentCalendarRedirect('calendar', true, () => Promise.reject(new Error('network'))) },
        { path: '/calendar/:calendar', component: Stub, name: 'calendar' },
      ],
    });
    await failing.push('/');

    await expect(failing.push('/calendar')).rejects.toThrow('network');
    expect(failing.currentRoute.value.fullPath).toBe('/');
  });

  it('the redirect guard persists the resolved id without the sync guard', async () => {
    const redirectOnly = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/calendar', component: Stub, name: 'calendars',
          beforeEnter: createCurrentCalendarRedirect('calendar', true, load) },
        { path: '/calendar/:calendar', component: Stub, name: 'calendar' },
      ],
    });
    useCalendarStore().selectedCalendarId = 'gone';

    await redirectOnly.push('/calendar');

    expect(redirectOnly.currentRoute.value.fullPath).toBe('/calendar/first');
    expect(useCalendarStore().selectedCalendarId).toBe('o1');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBe('o1');
  });
});
