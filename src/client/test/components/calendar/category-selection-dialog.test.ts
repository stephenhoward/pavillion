import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { nextTick } from 'vue';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import i18next from 'i18next';
import type { VueWrapper } from '@vue/test-utils';

import { mountComponent } from '@/client/test/lib/vue';
import CategorySelectionDialog from '@/client/components/logged_in/calendar/category-selection-dialog.vue';
import { useEventStore } from '@/client/stores/eventStore';
import { CalendarEvent } from '@/common/model/events';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { screenReader } from '@/common/test-utils/screen-reader';

const mockBulkAssign = vi.fn();

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(function () {
    return { bulkAssignCategories: mockBulkAssign };
  }),
}));

const makeCategory = (id: string) => {
  const category = new EventCategory(id, 'calendar-123');
  category.addContent(EventCategoryContent.fromObject({ language: 'en', name: id }));
  return category;
};

const categoryA = makeCategory('A');
const categoryB = makeCategory('B');
const categoryC = makeCategory('C');

vi.mock('@/client/stores/categoryStore', () => ({
  useCategoryStore: () => ({
    categories: { 'calendar-123': [categoryA, categoryB, categoryC] },
  }),
}));

const makeEvent = (id: string, categories: EventCategory[]) => {
  const event = new CalendarEvent();
  event.id = id;
  event.calendarId = 'calendar-123';
  event.categories = categories;
  return event;
};

describe('CategorySelectionDialog', () => {
  const { showModal, close } = HTMLDialogElement.prototype;
  let pinia: Pinia;
  let wrapper: VueWrapper | null = null;

  const mountDialog = async (events: CalendarEvent[]) => {
    useEventStore(pinia).setEventsForCalendar('calendar-123', events);
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: {} }] });
    await router.push('/');
    wrapper = mountComponent(CategorySelectionDialog, router, {
      pinia,
      props: {
        visible: true,
        selectedEventIds: ['e1', 'e2', 'e3'],
        calendarId: 'calendar-123',
      },
      attachTo: document.body,
    });
    await nextTick();
    return wrapper;
  };

  const chip = (label: string) => wrapper!.find(`[role="switch"][aria-label="${label}"]`);

  beforeEach(() => {
    // happy-dom does not implement showModal()/close().
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    pinia = createPinia();
    setActivePinia(pinia);
    mockBulkAssign.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  const seeded = () => [
    makeEvent('e1', [categoryA, categoryB]),
    makeEvent('e2', [categoryA]),
    makeEvent('e3', [categoryA]),
  ];

  it('shows a category on every selected event as checked and disabled', async () => {
    await mountDialog(seeded());

    expect(chip('A').attributes('aria-checked')).toBe('true');
    expect(chip('A').attributes('disabled')).toBeDefined();
    expect(chip('B').attributes('aria-checked')).toBe('false');
    expect(chip('B').attributes('disabled')).toBeUndefined();
    expect(chip('C').attributes('aria-checked')).toBe('false');
    expect(chip('C').attributes('disabled')).toBeUndefined();
  });

  it('names categories on all and on some selected events in separate lines', async () => {
    await mountDialog(seeded());

    const onAll = wrapper!.find('[data-testid="already-on-all"]').text();
    const onSome = wrapper!.find('[data-testid="already-on-some"]').text();
    expect(onAll.endsWith(': A')).toBe(true);
    expect(onSome.endsWith(': B')).toBe(true);
  });

  it('always states that assigning only adds categories', async () => {
    await mountDialog(seeded());

    expect(wrapper!.find('.assign-note').text())
      .toBe(i18next.t('calendars:bulk_operations.assign_categories_adds_only'));
  });

  it('omits the already-assigned lines when no selected event has a category', async () => {
    await mountDialog([makeEvent('e1', []), makeEvent('e2', []), makeEvent('e3', [])]);

    expect(wrapper!.find('[data-testid="already-on-all"]').exists()).toBe(false);
    expect(wrapper!.find('[data-testid="already-on-some"]').exists()).toBe(false);
    expect(wrapper!.find('.assign-note').exists()).toBe(true);
  });

  it('sends only the categories the user chose, never the ones already on every event', async () => {
    await mountDialog(seeded());

    await chip('B').trigger('click');
    const assign = wrapper!.findAll('button').find(b => b.text() === i18next.t('calendars:bulk_operations.assign_categories'));
    await assign!.trigger('click');
    await vi.waitFor(() => expect(mockBulkAssign).toHaveBeenCalled());

    expect(mockBulkAssign).toHaveBeenCalledWith(['e1', 'e2', 'e3'], ['B']);
    expect(wrapper!.emitted('assign-complete')![0][0]).toEqual({ eventCount: 3, categoryCount: 1 });
  });

  it('announces a category on every event as checked and disabled', async () => {
    await mountDialog(seeded());

    const sr = await screenReader(wrapper!.element as unknown as Node);
    try {
      expect(await sr.walk()).toContain('switch, A, checked, disabled');
    }
    finally {
      await sr.stop();
    }
  });
});
