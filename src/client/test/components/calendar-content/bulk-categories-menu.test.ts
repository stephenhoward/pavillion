import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import i18next from 'i18next';
import { mountComponent } from '@/client/test/lib/vue';
import BulkCategoriesMenu from '@/client/components/logged_in/calendar-content/bulk-categories-menu.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const SELECTED_COUNT_KEY = 'calendars:bulk_category_operations.selected_count';

const createWrapper = (selectedCount: number) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  return mountComponent(BulkCategoriesMenu, router, {
    props: { selectedCount },
  });
};

describe('BulkCategoriesMenu selection caption', () => {
  let wrapper: ReturnType<typeof createWrapper> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it.each([2, 3])('renders the translated caption for %i selected categories', (count) => {
    wrapper = createWrapper(count);

    expect(i18next.exists(SELECTED_COUNT_KEY, { count })).toBe(true);
    const expected = i18next.t(SELECTED_COUNT_KEY, { count });
    expect(wrapper.find('.selection-text').text()).toBe(expected);
  });
});

describe('BulkCategoriesMenu action buttons', () => {
  let wrapper: ReturnType<typeof createWrapper> | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it.each([
    ['merge-categories-btn', 'calendars:bulk_category_operations.merge_categories'],
    ['deselect-all-btn', 'calendars:bulk_category_operations.deselect_all'],
  ])('renders the translated label on %s', (testId, key) => {
    wrapper = createWrapper(2);

    expect(i18next.exists(key)).toBe(true);
    expect(wrapper.find(`[data-testid="${testId}"]`).text()).toBe(i18next.t(key));
  });
});
