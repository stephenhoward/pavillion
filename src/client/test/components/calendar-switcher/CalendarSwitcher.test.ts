import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import Switcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';
import CalendarService from '@/client/service/calendar';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const Stub = { template: '<div />' };
const router = () => createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: Stub, name: 'home' },
    { path: '/calendar/:calendar', component: Stub, name: 'calendar' },
    { path: '/feed/:calendar', component: Stub, name: 'feed' },
    { path: '/settings/calendar/:calendar', component: Stub, name: 'calendar_management' },
  ],
});

describe('CalendarSwitcher', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  const props = { calendarName: 'Riverside', routeName: 'calendar', currentUrlName: 'riverside' };

  // Every host shows the same control: the calendar's name and a chevron,
  // named "Switch calendar: {name}" by the switcher itself.
  it('shows the calendar name and a chevron, named by the switcher itself, with dialog popup semantics', () => {
    const wrapper = mountComponent(Switcher, router(), { pinia, props });
    const trigger = wrapper.find('button');
    expect(trigger.find('.calendar-switcher__label').text()).toBe('Riverside');
    expect(trigger.find('svg').attributes('aria-hidden')).toBe('true');
    expect(trigger.attributes('aria-label')).toBe('Switch calendar: Riverside');
    expect(trigger.attributes('aria-haspopup')).toBe('dialog');
    wrapper.unmount();
  });

  it('toggles aria-expanded and opens the sheet', async () => {
    const wrapper = mountComponent(Switcher, router(), {
      pinia,
      props,
      stubs: { CalendarSwitcherSheet: { template: '<div data-testid="sheet" />' } },
    });
    const trigger = wrapper.find('button');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[data-testid="sheet"]').exists()).toBe(false);
    await trigger.trigger('click');
    expect(trigger.attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('[data-testid="sheet"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('closes the sheet when it emits close', async () => {
    const wrapper = mountComponent(Switcher, router(), {
      pinia,
      props,
      stubs: { CalendarSwitcherSheet: { template: '<button data-testid="emit-close" @click="$emit(\'close\')" />' } },
    });
    await wrapper.find('button').trigger('click');
    await wrapper.find('[data-testid="emit-close"]').trigger('click');
    expect(wrapper.find('[data-testid="emit-close"]').exists()).toBe(false);
    expect(wrapper.find('button').attributes('aria-expanded')).toBe('false');
    wrapper.unmount();
  });

  it('opens the create sheet when the sheet emits create', async () => {
    const wrapper = mountComponent(Switcher, router(), {
      pinia,
      props,
      stubs: {
        CalendarSwitcherSheet: { template: '<button data-testid="emit-create" @click="$emit(\'create\')" />' },
        CreateCalendarSheet: { template: '<div data-testid="create-sheet" />' },
      },
    });
    await wrapper.find('button').trigger('click');
    await wrapper.find('[data-testid="emit-create"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="create-sheet"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="emit-create"]').exists()).toBe(false);
    // Unmounted so a later mount's locale re-render cannot reach this tree
    // after its stubs are gone.
    wrapper.unmount();
  });

  describe('with the real sheets', () => {
    let sandbox: sinon.SinonSandbox;
    let wrapper: VueWrapper | null = null;
    const { showModal, close } = HTMLDialogElement.prototype;

    beforeEach(() => {
      // happy-dom does not implement showModal()/close(). Polyfill just enough
      // for the real sheet's useDialog to open, so focus really leaves the
      // trigger and the test proves it comes back.
      HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
      HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
      sandbox = sinon.createSandbox();
      useCalendarStore().setCalendarInfos([
        new CalendarInfo(new Calendar('c1', 'riverside'), 'owner'),
        new CalendarInfo(new Calendar('c2', 'hillside'), 'owner'),
      ]);
      sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded')
        .callsFake(async () => useCalendarStore().calendarInfos);
    });

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
      sandbox.restore();
      HTMLDialogElement.prototype.showModal = showModal;
      HTMLDialogElement.prototype.close = close;
    });

    const openSheet = async (stubs: Record<string, unknown> = {}, mountProps = props, startPath = '/calendar/riverside') => {
      const r = router();
      await r.push(startPath);
      wrapper = mountComponent(Switcher, r, {
        pinia,
        props: mountProps,
        stubs,
        attachTo: document.body,
        provide: { site_config: { settings: () => ({ domain: 'pavillion.dev' }) } },
      });
      const trigger = wrapper.find<HTMLButtonElement>('button.calendar-switcher');
      trigger.element.focus();
      await trigger.trigger('click');
      await flushPromises();
      // useDialog moves initial focus into the sheet on a zero-delay timer.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.activeElement).not.toBe(trigger.element);
      return { wrapper, trigger: trigger.element, router: r };
    };

    it('returns focus to the trigger after a calendar is picked', async () => {
      const { wrapper: w, trigger } = await openSheet();

      await w.find('[data-url-name="hillside"] a').trigger('click');
      await flushPromises();

      expect(w.find('[data-testid="switcher-row"]').exists()).toBe(false);
      expect(document.activeElement).toBe(trigger);
    });

    it('hands the create sheet the trigger as its focus target and refocuses it on close', async () => {
      let focusedWhenCreateOpened: Element | null = null;
      const { wrapper: w, trigger } = await openSheet({
        CreateCalendarSheet: {
          template: '<button data-testid="close-create" @click="$emit(\'close\')" />',
          mounted() {
            focusedWhenCreateOpened = document.activeElement;
          },
        },
      });

      await w.find('[data-testid="switcher-create"]').trigger('click');
      await flushPromises();
      expect(focusedWhenCreateOpened).toBe(trigger);

      await w.find('[data-testid="close-create"]').trigger('click');
      await flushPromises();

      expect(w.find('[data-testid="close-create"]').exists()).toBe(false);
      expect(document.activeElement).toBe(trigger);
    });

    it.each([
      ['feed', '/feed/riverside', '/feed/new-calendar'],
      ['calendar_management', '/settings/calendar/riverside', '/settings/calendar/new-calendar'],
      ['calendar', '/calendar/riverside', '/calendar/new-calendar'],
    ])('lands a calendar created from the %s switcher on that route', async (routeName, startPath, expectedPath) => {
      sandbox.stub(CalendarService.prototype, 'createCalendar').resolves(new Calendar('c3', 'new-calendar'));
      const { wrapper: w, router: r } = await openSheet({}, { ...props, routeName }, startPath);

      await w.find('[data-testid="switcher-create"]').trigger('click');
      await flushPromises();
      await w.find('#calendar-name').setValue('new-calendar');
      await w.find('form').trigger('submit');
      await flushPromises();

      expect(r.currentRoute.value.path).toBe(expectedPath);
      expect(w.find('#calendar-name').exists()).toBe(false);
    });
  });
});
