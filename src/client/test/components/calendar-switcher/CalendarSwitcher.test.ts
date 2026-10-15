import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import Switcher from '@/client/components/logged_in/calendar-switcher/CalendarSwitcher.vue';

const Stub = { template: '<div />' };
const router = () => createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: Stub, name: 'home' }] });

describe('CalendarSwitcher', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  const props = { label: 'Riverside', routeName: 'calendar', currentUrlName: 'riverside', ariaLabel: 'Switch calendar: Riverside' };

  it('renders the label with the accessible name and dialog popup semantics', () => {
    const wrapper = mountComponent(Switcher, router(), { pinia, props });
    const trigger = wrapper.find('button');
    expect(trigger.text()).toContain('Riverside');
    expect(trigger.attributes('aria-label')).toBe('Switch calendar: Riverside');
    expect(trigger.attributes('aria-haspopup')).toBe('dialog');
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
    expect(wrapper.find('[data-testid="create-sheet"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="emit-create"]').exists()).toBe(false);
  });
});
