import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import NoCalendars from '@/client/components/logged_in/calendar/NoCalendars.vue';

describe('NoCalendars', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function mountPage() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/calendar', component: {}, name: 'calendars' }],
    });
    return mountComponent(NoCalendars, router, {
      stubs: { CreateCalendarSheet: { template: '<div data-testid="create-sheet" />' } },
    });
  }

  it('renders the empty state without a landmark of its own, since the shell provides <main>', () => {
    const wrapper = mountPage();
    expect(wrapper.find('main').exists()).toBe(false);
    expect(wrapper.find('h2').text()).toBe('Create your first calendar');
    expect(wrapper.find('.doc-link').text()).toBe('How to create a calendar');
  });

  it('offers only the create action and opens the create sheet', async () => {
    const wrapper = mountPage();
    expect(wrapper.find('[data-testid="create-sheet"]').exists()).toBe(false);
    // The guide link is a button too (it opens the help panel); it is not an action.
    const buttons = wrapper.findAll('button:not(.doc-link)');
    expect(buttons.length).toBe(1);
    await buttons[0].trigger('click');
    expect(wrapper.find('[data-testid="create-sheet"]').exists()).toBe(true);
  });
});
