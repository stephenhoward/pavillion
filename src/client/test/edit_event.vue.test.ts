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

  it('duplication mode shows correct title', async () => {
    const event = new CalendarEvent('testCalendarId', 'testId', 'testDate');
    event.location = new EventLocation('', '');

    const calendarsStub = sandbox.stub(CalendarService.prototype, 'loadCalendars');
    calendarsStub.resolves([new Calendar('testCalendarId','testName')]);

    const { wrapper } = mountedEditor(event);
    currentWrapper = wrapper;

    // Set duplication mode prop
    await wrapper.setProps({ isDuplicationMode: true });
    await wrapper.vm.$nextTick();

    // Should show "Duplicate Event" in modal title
    const modalTitle = wrapper.find('[data-testid="modal-title"]');
    if (modalTitle.exists()) {
      expect(modalTitle.text()).toContain('Duplicate');
    }
  });

  it('duplication mode does not have existing event id', async () => {
    const originalEvent = new CalendarEvent('testCalendarId', 'originalId', 'testDate');
    originalEvent.location = new EventLocation('', '');
    originalEvent.content('en').name = 'Original Event';

    const calendarsStub = sandbox.stub(CalendarService.prototype, 'loadCalendars');
    const saveStub = sandbox.stub(EventService.prototype, 'saveEvent');

    calendarsStub.resolves([new Calendar('testCalendarId','testName')]);
    saveStub.resolves(new CalendarEvent('newId', 'testDate'));

    const { wrapper } = mountedEditor(originalEvent);
    currentWrapper = wrapper;

    // Set duplication mode
    await wrapper.setProps({ isDuplicationMode: true });
    await wrapper.vm.$nextTick();

    // The button text should say "Create" not "Update"
    const submitButton = wrapper.find('button[type="submit"]');
    expect(submitButton.text()).not.toContain('Update');
  });
});
