import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import Sheet from '@/client/components/logged_in/calendar-switcher/CalendarSwitcherSheet.vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const Stub = { template: '<div />' };

function seed() {
  useCalendarStore().setCalendarInfos([
    new CalendarInfo(new Calendar('e1', 'edited-one'), 'editor'),
    new CalendarInfo(new Calendar('o1', 'owned-one'), 'owner'),
    new CalendarInfo(new Calendar('o2', 'owned-two'), 'owner'),
  ]);
}

function makeRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Stub, name: 'home' },
      { path: '/feed/:calendar', component: Stub, name: 'feed' },
      { path: '/settings/calendar/:calendar', component: Stub, name: 'calendar_management' },
    ],
  });
}

describe('CalendarSwitcherSheet', () => {
  let pinia: Pinia;
  let sandbox: sinon.SinonSandbox;
  let ensureLoaded: sinon.SinonStub;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();
    ensureLoaded = sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded')
      .callsFake(async () => useCalendarStore().calendarInfos);
  });

  afterEach(() => sandbox.restore());

  it('revalidates the calendar list for the signed-in account on open', () => {
    seed();
    mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'feed', currentUrlName: null } });
    sinon.assert.calledOnce(ensureLoaded);
  });

  it('keeps listing calendars when the revalidation fails', async () => {
    seed();
    ensureLoaded.rejects(new Error('network'));
    const wrapper = mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'feed', currentUrlName: null } });
    await flushPromises();
    expect(wrapper.findAll('[data-testid="switcher-row"]').length).toBe(3);
  });

  it('lists owned then edited calendars with the editor badge', () => {
    seed();
    const wrapper = mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'feed', currentUrlName: 'owned-one' } });
    const rows = wrapper.findAll('[data-testid="switcher-row"]');
    expect(rows.map((r) => r.attributes('data-url-name'))).toEqual(['owned-one', 'owned-two', 'edited-one']);
    expect(rows[2].text()).toContain('Editor');
    expect(rows[0].text()).not.toContain('Editor');
  });

  it('marks the current row and renders it inert', () => {
    seed();
    const wrapper = mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'feed', currentUrlName: 'owned-one' } });
    const current = wrapper.find('[data-url-name="owned-one"]');
    expect(current.attributes('aria-current')).toBe('true');
    expect(current.find('a').exists()).toBe(false);
    expect(current.find('.sr-only').text()).toBe('Current');
    expect(wrapper.find('[data-url-name="owned-two"]').attributes('aria-current')).toBeUndefined();
  });

  it('navigates on the host route and emits close', async () => {
    seed();
    const router = makeRouter();
    await router.push('/');
    const wrapper = mountComponent(Sheet, router, { pinia, props: { routeName: 'calendar_management', currentUrlName: 'owned-one' } });
    const link = wrapper.find('[data-url-name="owned-two"] a');
    expect(link.attributes('href')).toBe('/settings/calendar/owned-two');
    await link.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/settings/calendar/owned-two');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('with no current calendar every row navigates', () => {
    seed();
    const wrapper = mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'calendar_management', currentUrlName: null } });
    expect(wrapper.findAll('[data-testid="switcher-row"] a').length).toBe(3);
    expect(wrapper.find('[aria-current="true"]').exists()).toBe(false);
  });

  it('emits create from the create row, which closes the list', async () => {
    seed();
    const wrapper = mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'feed', currentUrlName: null } });
    await wrapper.find('[data-testid="switcher-create"]').trigger('click');
    expect(wrapper.emitted('create')).toBeTruthy();
    const items = wrapper.findAll('li');
    expect(items[items.length - 1].find('[data-testid="switcher-create"]').exists()).toBe(true);
  });

  it('shows only the create row for an account with no calendars', () => {
    useCalendarStore().setCalendarInfos([]);
    const wrapper = mountComponent(Sheet, makeRouter(), { pinia, props: { routeName: 'feed', currentUrlName: null } });
    expect(wrapper.findAll('[data-testid="switcher-row"]').length).toBe(0);
    expect(wrapper.find('[data-testid="switcher-create"]').exists()).toBe(true);
  });
});
