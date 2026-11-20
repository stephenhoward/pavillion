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

const createWrapper = async (
  props: Record<string, unknown> = {},
  options: { attachTo?: Element } = {},
) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push({ name: 'calendars' });

  const wrapper = mountComponent(CreateCalendarForm, router, {
    props,
    attachTo: options.attachTo,
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

/**
 * The control's accessible name from the sources that count as a label:
 * aria-labelledby, a <label for>, a wrapping <label>, then aria-label.
 * Placeholder and title are deliberately ignored — they are not names.
 */
function labelledName(control: HTMLElement): string {
  const doc = control.ownerDocument;
  const labelledBy = control.getAttribute('aria-labelledby');
  if (labelledBy) {
    return labelledBy.split(/\s+/)
      .map(id => doc.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
  }
  if (control.id) {
    const forLabel = doc.querySelector(`label[for="${control.id}"]`);
    if (forLabel?.textContent?.trim()) return forLabel.textContent.trim();
  }
  const wrapping = control.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
  return control.getAttribute('aria-label')?.trim() ?? '';
}

describe('CreateCalendarForm calendar name label', () => {
  it('shows a visible label associated with the name input', async () => {
    const { wrapper } = await createWrapper({}, { attachTo: document.body });

    const input = wrapper.find('#calendar-name');
    const label = wrapper.find('label.calendar-name-label');

    expect(label.exists()).toBe(true);
    expect(label.classes()).not.toContain('sr-only');
    expect(label.attributes('for')).toBe(input.attributes('id'));
    expect(label.text()).toBe(message('label_calendar_name'));
    expect(label.text()).not.toContain('pavillion.dev');
    expect(labelledName(input.element as HTMLElement)).toBe(message('label_calendar_name'));

    wrapper.unmount();
  });

  it('names every form control without relying on a placeholder', async () => {
    const { wrapper } = await createWrapper({}, { attachTo: document.body });

    const controls = wrapper.findAll('input, select, textarea');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(labelledName(control.element as HTMLElement), `control #${control.attributes('id')}`).not.toBe('');
    }

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
