/**
 * Tests for the shared CalendarViewToolbar: the view radiogroup and the
 * period controls that accompany the week and month views.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { DateTime } from 'luxon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';

import CalendarViewToolbar from '@/common/ui/calendar-views/CalendarViewToolbar.vue';
import { uiResources } from '@/common/ui/locales';
import type { CalendarViewMode } from '@/common/model/calendar_view';

const ALL_VIEWS: readonly CalendarViewMode[] = ['list', 'week', 'month'];

let mounted: VueWrapper | undefined;

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.init({ lng: 'en', fallbackLng: 'en', resources: { en: uiResources.en } });
  }
  else {
    i18next.addResourceBundle('en', 'ui', uiResources.en.ui, true, true);
  }
  await i18next.changeLanguage('en');
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function mountToolbar(props: { viewMode?: CalendarViewMode; availableViews?: readonly CalendarViewMode[] } = {}) {
  mounted = mount(CalendarViewToolbar, {
    attachTo: document.body,
    props: {
      viewMode: props.viewMode ?? 'list',
      availableViews: props.availableViews ?? ALL_VIEWS,
      anchorDate: DateTime.fromISO('2026-10-05'),
      periodLabel: 'October 2026',
    },
    global: { plugins: [[I18NextVue, { i18next }]] },
  });

  return mounted;
}

function radios(wrapper: VueWrapper) {
  return wrapper.findAll('[role="radio"]');
}

describe('CalendarViewToolbar', () => {
  describe('view radiogroup', () => {
    it('lists only the available views, labelled from the ui namespace', () => {
      const wrapper = mountToolbar({ availableViews: ['list', 'week'] });

      expect(radios(wrapper).map(radio => radio.text())).toEqual(['List', 'Week']);
    });

    it('renders nothing when only one view is available', () => {
      const wrapper = mountToolbar({ availableViews: ['list'] });

      expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false);
      expect(wrapper.find('button').exists()).toBe(false);
    });

    it('is a radiogroup labelled from the ui namespace', () => {
      const wrapper = mountToolbar();

      expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe('Calendar view');
    });

    it('marks only the current view as checked and gives it the only tab stop', () => {
      const wrapper = mountToolbar({ viewMode: 'week' });

      expect(radios(wrapper).map(radio => radio.attributes('aria-checked'))).toEqual(['false', 'true', 'false']);
      expect(radios(wrapper).map(radio => radio.attributes('tabindex'))).toEqual(['-1', '0', '-1']);
    });

    it('emits update:viewMode with the clicked view', async () => {
      const wrapper = mountToolbar({ viewMode: 'list' });

      await radios(wrapper)[2].trigger('click');

      expect(wrapper.emitted('update:viewMode')).toEqual([['month']]);
    });

    it.each([
      ['ArrowRight', 'list', 'week'],
      ['ArrowDown', 'list', 'week'],
      ['ArrowLeft', 'week', 'list'],
      ['ArrowUp', 'week', 'list'],
      ['ArrowRight', 'month', 'list'],
      ['ArrowLeft', 'list', 'month'],
      ['Home', 'month', 'list'],
      ['End', 'list', 'month'],
    ] as const)('%s from %s selects %s', async (key, from, to) => {
      const wrapper = mountToolbar({ viewMode: from });
      const index = ALL_VIEWS.indexOf(from);

      await radios(wrapper)[index].trigger('keydown', { key });

      expect(wrapper.emitted('update:viewMode')).toEqual([[to]]);
    });

    it('moves focus to the newly selected view once the parent applies it', async () => {
      const wrapper = mountToolbar({ viewMode: 'list' });

      await radios(wrapper)[0].trigger('keydown', { key: 'ArrowRight' });
      await wrapper.setProps({ viewMode: 'week' });

      expect(document.activeElement).toBe(radios(wrapper)[1].element);
    });

    it('moves among available views only', async () => {
      const wrapper = mountToolbar({ viewMode: 'month', availableViews: ['list', 'month'] });

      await radios(wrapper)[1].trigger('keydown', { key: 'ArrowRight' });

      expect(wrapper.emitted('update:viewMode')).toEqual([['list']]);
    });

    it('ignores other keys', async () => {
      const wrapper = mountToolbar({ viewMode: 'list' });

      await radios(wrapper)[0].trigger('keydown', { key: 'a' });

      expect(wrapper.emitted('update:viewMode')).toBeUndefined();
    });
  });

  describe('period controls', () => {
    it('are absent in the list view', () => {
      const wrapper = mountToolbar({ viewMode: 'list' });

      expect(wrapper.find('.ui-view-toolbar__period').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('October 2026');
    });

    it.each(['week', 'month'] as const)('are present in the %s view with labelled buttons and the period label', (viewMode) => {
      const wrapper = mountToolbar({ viewMode });

      expect(wrapper.find('[aria-label="Previous"]').exists()).toBe(true);
      expect(wrapper.find('[aria-label="Next"]').exists()).toBe(true);
      expect(wrapper.find('.ui-view-toolbar__today').text()).toBe('Today');
      expect(wrapper.find('[aria-live="polite"]').text()).toBe('October 2026');
    });

    it('emit prev, today and next', async () => {
      const wrapper = mountToolbar({ viewMode: 'month' });

      await wrapper.find('[aria-label="Previous"]').trigger('click');
      await wrapper.find('.ui-view-toolbar__today').trigger('click');
      await wrapper.find('[aria-label="Next"]').trigger('click');

      expect(wrapper.emitted('prev')).toHaveLength(1);
      expect(wrapper.emitted('today')).toHaveLength(1);
      expect(wrapper.emitted('next')).toHaveLength(1);
    });
  });
});
