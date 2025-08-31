import{ expect, describe, it, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import { nextTick } from 'vue';

import { CalendarEvent } from '@/common/model/events';
import { EventLocation } from '@/common/model/location';
import { Calendar } from '@/common/model/calendar';
import { mountComponent } from '@/client/test/lib/vue';
import EditEvent from '@/client/components/logged_in/calendar/edit_event.vue';
import EventService from '@/client/service/event';
import CalendarService from '@/client/service/calendar';

const routes: RouteRecordRaw[] = [
  { path: '/login',  component: {}, name: 'login', props: true },
  { path: '/logout', component: {}, name: 'logout' },
  { path: '/register', component: {}, name: 'register', props: true },
  { path: '/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/apply',  component: {}, name: 'register-apply', props: true },
  { path: '/reset',  component: {}, name: 'reset_password', props: true },
];

const mountedEditor = (event: CalendarEvent) => {
  let router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const wrapper = mountComponent(EditEvent, router, {
    provide: {
      site_config: {
        settings: {},
      },
    },
    props: {
      event: event,
    },
  });

  return {
    wrapper,
    router,
  };
};

describe('Editor Behavior', () => {
  const sandbox = sinon.createSandbox();
  let currentWrapper: any = null;

  afterEach(async () => {
    sandbox.restore();
    // Properly unmount Vue component and wait for cleanup
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
      await nextTick();
    }
  });

  it('new event, no calendar', async () => {
    let event = new CalendarEvent('', '');
    event.location = new EventLocation('', '');

    const calendarsStub = sandbox.stub(CalendarService.prototype, 'loadCalendars');
    const createStub = sandbox.stub(EventService.prototype, 'saveEvent');

    calendarsStub.resolves([]);
    createStub.resolves(new CalendarEvent('id', 'testDate'));

    const { wrapper } = mountedEditor(event);
    currentWrapper = wrapper;

    wrapper.find('input[name="name"]').setValue('testName');
    wrapper.find('input[name="description"]').setValue('testDescription');

    // Click the button which should trigger form submission
    await wrapper.find('button[type="submit"]').trigger('click');
    // Also trigger the form submit event to ensure the handler is called
    await wrapper.find('form').trigger('submit');
    await wrapper.vm.$nextTick();

    expect(createStub.called).toBe(false);
  });

  it('new event, with calendar', async () => {
    const calendar = new Calendar('testId','testName');
    const event = new CalendarEvent('', '');
    event.location = new EventLocation('', '');
    event.calendarId = 'testId';

    const calendarsStub = sandbox.stub(CalendarService.prototype, 'loadCalendars');
    const createStub = sandbox.stub(EventService.prototype, 'saveEvent');

    calendarsStub.resolves([calendar]);
    createStub.resolves(new CalendarEvent('id', 'testDate'));

    const { wrapper } = mountedEditor(event);
    currentWrapper = wrapper;

    wrapper.find('input[name="name"]').setValue('testName');
    wrapper.find('input[name="description"]').setValue('testDescription');

    // Click the button which should trigger form submission
    await wrapper.find('button[type="submit"]').trigger('click');
    // Also trigger the form submit event to ensure the handler is called
    await wrapper.find('form').trigger('submit');
    await wrapper.vm.$nextTick();

    expect(createStub.called).toBe(true);
  });
});
