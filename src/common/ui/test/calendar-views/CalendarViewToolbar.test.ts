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

function mountToolbar(props: {
  viewMode?: CalendarViewMode;
  availableViews?: readonly CalendarViewMode[];
  attachTo?: HTMLElement;
} = {}) {
  mounted = mount(CalendarViewToolbar, {
    attachTo: props.attachTo ?? document.body,
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

      expect(radios(wrapper).map(radio => radio.attributes('aria-label'))).toEqual(['List', 'Week']);
    });

    it('labels the month view from the ui namespace', () => {
      const wrapper = mountToolbar();

      expect(radios(wrapper).map(radio => radio.attributes('aria-label'))).toEqual(['List', 'Week', 'Month']);
    });

    it('shows each view as an icon the screen reader skips, with the label as a tooltip', () => {
      const wrapper = mountToolbar();

      for (const radio of radios(wrapper)) {
        expect(radio.text()).toBe('');
        expect(radio.find('svg').attributes('aria-hidden')).toBe('true');
        expect(radio.attributes('title')).toBeTruthy();
        expect(radio.attributes('title')).toBe(radio.attributes('aria-label'));
      }
    });

    it('gives each view a different icon', () => {
      const wrapper = mountToolbar();

      const icons = radios(wrapper).map(radio => radio.find('svg').html());

      expect(new Set(icons).size).toBe(ALL_VIEWS.length);
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

    it('keeps the group reachable when the current view is not offered', () => {
      const wrapper = mountToolbar({ viewMode: 'month', availableViews: ['list', 'week'] });

      expect(radios(wrapper).map(radio => radio.attributes('tabindex'))).toEqual(['0', '-1']);
      expect(radios(wrapper).every(radio => radio.attributes('aria-checked') === 'false')).toBe(true);
    });

    it('emits nothing when the checked view is clicked', async () => {
      const wrapper = mountToolbar({ viewMode: 'week' });

      await radios(wrapper)[1].trigger('click');

      expect(wrapper.emitted('update:viewMode')).toBeUndefined();
    });

    it.each([
      ['Home', 'list'],
      ['End', 'month'],
    ] as const)('emits nothing for %s on the view already at that end', async (key, view) => {
      const wrapper = mountToolbar({ viewMode: view });

      await radios(wrapper)[ALL_VIEWS.indexOf(view)].trigger('keydown', { key });

      expect(wrapper.emitted('update:viewMode')).toBeUndefined();
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

    it('does not take focus when the parent changes the view without a key press', async () => {
      const wrapper = mountToolbar({ viewMode: 'list' });
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      outside.focus();

      await wrapper.setProps({ viewMode: 'week' });

      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it('does not take focus for a parent change after focus has left the group', async () => {
      const wrapper = mountToolbar({ viewMode: 'list' });
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      const first = radios(wrapper)[0].element as HTMLElement;
      first.focus();

      await radios(wrapper)[0].trigger('keydown', { key: 'ArrowRight' });
      outside.focus();
      await wrapper.setProps({ viewMode: 'week' });

      expect(document.activeElement).toBe(outside);
      outside.remove();
    });

    it.each([
      ['ArrowLeft', 'list', 'week'],
      ['ArrowRight', 'week', 'list'],
      ['ArrowDown', 'list', 'week'],
      ['ArrowUp', 'week', 'list'],
    ] as const)('in right-to-left text, %s from %s selects %s', async (key, from, to) => {
      const rtl = document.createElement('div');
      rtl.setAttribute('dir', 'rtl');
      document.body.appendChild(rtl);
      const wrapper = mountToolbar({ viewMode: from, attachTo: rtl });

      await radios(wrapper)[ALL_VIEWS.indexOf(from)].trigger('keydown', { key });

      expect(wrapper.emitted('update:viewMode')).toEqual([[to]]);
      wrapper.unmount();
      mounted = undefined;
      rtl.remove();
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

    it.each(['week', 'month'] as const)('head the %s view with the period, ahead of the view switcher', (viewMode) => {
      const wrapper = mountToolbar({ viewMode });
      const heading = wrapper.find('h2.ui-view-toolbar__label');

      expect(heading.text()).toBe('October 2026');
      expect(heading.element.compareDocumentPosition(wrapper.find('[role="radiogroup"]').element))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
