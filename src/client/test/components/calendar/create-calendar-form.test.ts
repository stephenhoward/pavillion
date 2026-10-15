import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import i18next from 'i18next';
import { mountComponent } from '@/client/test/lib/vue';
import CreateCalendarForm from '@/client/components/logged_in/calendar/CreateCalendarForm.vue';
import CalendarService from '@/client/service/calendar';
import { Calendar } from '@/common/model/calendar';

/**
 * The create-calendar form pre-checks the name before any server round trip:
 * shape first, then reservation. A title that autofills a reserved name must
 * be stopped on submit with the reserved-name message, not sent to the server.
 */

const routes: RouteRecordRaw[] = [
  { path: '/calendars', component: {}, name: 'calendars' },
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/feed/:calendar', component: {}, name: 'feed' },
  { path: '/settings/calendar/:calendar', component: {}, name: 'calendar_management' },
];

const createWrapper = async (props: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push({ name: 'calendars' });

  const wrapper = mountComponent(CreateCalendarForm, router, {
    props,
    provide: {
      site_config: { settings: () => ({ domain: 'pavillion.dev' }) },
    },
  });
  await flushPromises();
  return { wrapper, router };
};

const message = (key: string) => i18next.t(`calendars:list.${key}`);

describe('CreateCalendarForm name pre-check', () => {
  let sandbox: sinon.SinonSandbox;
  let createStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    createStub = sandbox.stub(CalendarService.prototype, 'createCalendar');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('rejects a reserved name autofilled from the title without calling the server', async () => {
    const { wrapper } = await createWrapper();

    await wrapper.find('#calendar-title').setValue('Admin');
    expect((wrapper.find('#calendar-name').element as HTMLInputElement).value).toBe('admin');

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    const alert = wrapper.find('#calendar-error');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toBe(message('error_reserved_calendar_name'));
    expect(alert.text()).not.toBe(message('error_invalid_calendar_name'));
    expect(createStub.called).toBe(false);

    wrapper.unmount();
  });

  it('rejects a shape-invalid name with the invalid-name message without calling the server', async () => {
    const { wrapper } = await createWrapper();

    await wrapper.find('#calendar-name').setValue('-bad');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('#calendar-error').text()).toBe(message('error_invalid_calendar_name'));
    expect(createStub.called).toBe(false);

    wrapper.unmount();
  });

  it('sends a valid name to the server', async () => {
    const calendar = new Calendar('cal-id', 'community-events');
    createStub.resolves(calendar);
    const { wrapper } = await createWrapper();

    await wrapper.find('#calendar-name').setValue('community-events');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(createStub.calledOnce).toBe(true);
    expect(createStub.firstCall.args[0]).toBe('community-events');
    expect(wrapper.find('#calendar-error').exists()).toBe(false);

    wrapper.unmount();
  });
});

describe('CreateCalendarForm navigation after create', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(CalendarService.prototype, 'createCalendar').resolves(new Calendar('cal-id', 'community-events'));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it.each([
    ['the calendar page by default', {}, '/calendar/community-events'],
    ['the feed when the host is the feed', { routeName: 'feed' }, '/feed/community-events'],
    ['calendar settings when the host is settings', { routeName: 'calendar_management' }, '/settings/calendar/community-events'],
  ])('lands on %s', async (_label, props, expectedPath) => {
    const { wrapper, router } = await createWrapper(props);

    await wrapper.find('#calendar-name').setValue('community-events');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe(expectedPath);
    expect(wrapper.emitted('created')).toHaveLength(1);

    wrapper.unmount();
  });
});
