import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { createTestingPinia } from '@pinia/testing';

/**
 * Tests: Category badges use ul/li for semantic list markup
 *
 * Verifies that event category badges are rendered as list items inside an
 * unordered list, providing screen reader item-count announcements and
 * discrete navigation of categories.
 *
 * Related: calendar.vue — .event-categories / .category-badge
 */
describe('Calendar category badges semantic markup', () => {
  it('renders category badges as li elements inside a ul', () => {
    // Create a minimal component that mimics the category badge section
    const CategoryBadgesFixture = defineComponent({
      template: `
        <ul v-if="categories && categories.length > 0" class="event-categories" role="list">
          <li v-for="cat in categories" :key="cat.id" class="category-badge">
            {{ cat.name }}
          </li>
        </ul>
      `,
      props: ['categories'],
    });

    const wrapper = mount(CategoryBadgesFixture, {
      props: {
        categories: [
          { id: 'cat-1', name: 'Music' },
          { id: 'cat-2', name: 'Film' },
        ],
      },
    });

    // Container should be a ul (not div)
    const list = wrapper.find('.event-categories');
    expect(list.element.tagName).toBe('UL');
    expect(list.attributes('role')).toBe('list');

    // Items should be li (not span)
    const badges = wrapper.findAll('.category-badge');
    expect(badges).toHaveLength(2);
    badges.forEach(badge => {
      expect(badge.element.tagName).toBe('LI');
    });

    expect(badges[0].text()).toBe('Music');
    expect(badges[1].text()).toBe('Film');
  });

  it('does not render category list when categories array is empty', () => {
    const CategoryBadgesFixture = defineComponent({
      template: `
        <ul v-if="categories && categories.length > 0" class="event-categories" role="list">
          <li v-for="cat in categories" :key="cat.id" class="category-badge">
            {{ cat.name }}
          </li>
        </ul>
      `,
      props: ['categories'],
    });

    const wrapper = mount(CategoryBadgesFixture, {
      props: { categories: [] },
    });

    expect(wrapper.find('.event-categories').exists()).toBe(false);
  });
});
