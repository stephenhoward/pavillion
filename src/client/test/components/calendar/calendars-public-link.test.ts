import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import { mountComponent } from '@/client/test/lib/vue';
import CalendarsView from '@/client/components/logged_in/calendar/calendars.vue';
import CalendarService from '@/client/service/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

/**
 * Each card on the calendar list carries the calendar's public address — the
 * one an organizer copies and hands to someone else. It comes from the server's
 * `publicUrl` rather than being templated here, so it cannot drift from the
 * address the server actually serves the way the old `/view/...` href did.
 */

const routes: RouteRecordRaw[] = [
  { path: '/calendars', component: {}, name: 'calendars' },
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
];

const buildCalendarInfo = (urlName: string) => CalendarInfo.fromObject({
  id: `id-${urlName}`,
  urlName,
  publicUrl: `https://pavillion.dev/${urlName}`,
  userRelationship: 'owner',
  languages: ['en'],
  content: { en: { language: 'en', name: urlName, description: '' } },
});

// Two calendars, because a single one redirects straight to its own page
// instead of rendering the list.
const calendarInfos = [buildCalendarInfo('first-calendar'), buildCalendarInfo('second-calendar')];

const createWrapper = async () => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push({ name: 'calendars' });

  const wrapper = mountComponent(CalendarsView, router, {
    stubs: {
      EmptyLayout: { template: '<div />' },
      CreateCalendarForm: { template: '<div />' },
      CreateCalendarSheet: { template: '<div />' },
      HelpPanel: { template: '<div />' },
    },
  });

  await flushPromises();

  return wrapper;
};

describe('Calendar list public links', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('points each card link at the server-supplied publicUrl', async () => {
    sandbox.stub(CalendarService.prototype, 'loadCalendarsWithRelationship').resolves(calendarInfos);

    const wrapper = await createWrapper();

    const links = wrapper.findAll('a.calendar-card__public-link');
    expect(links.length).toBe(2);
    expect(links[0].attributes('href')).toBe('https://pavillion.dev/first-calendar');
    expect(links[1].attributes('href')).toBe('https://pavillion.dev/second-calendar');

    wrapper.unmount();
  });
});
