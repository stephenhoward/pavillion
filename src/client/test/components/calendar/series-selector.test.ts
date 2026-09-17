import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import SeriesSelector from '@/client/components/logged_in/calendar/series-selector.vue';
import CreateSeriesModal from '@/client/components/logged_in/calendar-content/create-series-modal.vue';
import SeriesService from '@/client/service/series';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

const routes: RouteRecordRaw[] = [
  { path: '/event', component: {}, name: 'event' },
];

/**
 * Helper to create a test series with translatable content
 */
function createTestSeries(id: string, name: string): EventSeries {
  const series = new EventSeries(id, 'calendar-123', `series-${id}`);
  series.addContent(EventSeriesContent.fromObject({
    language: 'en',
    name: name,
    description: '',
  }));
  return series;
}

const createWrapper = (props = {}, attachTo?: Element) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  return mountComponent(SeriesSelector, router, {
    props: {
      calendarId: 'calendar-123',
      selectedSeriesId: null,
      eventId: null,
      ...props,
    },
    stubs: {
      // The modal's internals are covered by create-series-modal.test.ts;
      // here we only drive its saved/close contract.
      CreateSeriesModal: {
        template: '<div class="create-series-modal-stub"></div>',
        props: ['series'],
        emits: ['saved', 'close'],
      },
    },
    ...(attachTo ? { attachTo } : {}),
  });
};

async function settle() {
  await nextTick();
  await nextTick();
}

async function openModal(wrapper: any) {
  await wrapper.find('[data-test="add-series-button"]').trigger('click');
  await nextTick();
  const modal = wrapper.findComponent(CreateSeriesModal);
  expect(modal.exists()).toBe(true);
  return modal;
}

describe('SeriesSelector', () => {
  let wrapper: any;
  let mockLoadSeries: any;

  const testSeries = [
    createTestSeries('series-1', 'Spring Festival'),
    createTestSeries('series-2', 'Summer Concert'),
    createTestSeries('series-3', 'Fall Expo'),
  ];

  beforeEach(() => {
    mockLoadSeries = vi.fn().mockResolvedValue(testSeries);
    vi.spyOn(SeriesService.prototype, 'loadSeries').mockImplementation(mockLoadSeries);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render a label and the series options', async () => {
      wrapper = createWrapper();

      await nextTick();
      await nextTick();

      // Should have the series label visible
      const label = wrapper.find('.series-label');
      expect(label.exists()).toBe(true);

      // Should have a select element or radio buttons
      const select = wrapper.find('select');
      expect(select.exists()).toBe(true);
    });

    it('should show the None option as the first option', async () => {
      wrapper = createWrapper();

      await nextTick();
      await nextTick();

      const options = wrapper.findAll('option');
      expect(options.length).toBeGreaterThan(0);

      // First option should be "None"
      const firstOption = options[0];
      expect(firstOption.attributes('value')).toBe('');
    });

    it('should show all loaded series as options', async () => {
      wrapper = createWrapper();

      await nextTick();
      await nextTick();

      const options = wrapper.findAll('option');
      // None + 3 series
      expect(options.length).toBe(4);
    });
  });

  describe('Initialization with selectedSeriesId', () => {
    it('should select the correct option when selectedSeriesId is provided', async () => {
      wrapper = createWrapper({ selectedSeriesId: 'series-2' });

      await nextTick();
      await nextTick();

      const select = wrapper.find('select');
      expect(select.element.value).toBe('series-2');
    });

    it('should select None when selectedSeriesId is null', async () => {
      wrapper = createWrapper({ selectedSeriesId: null });

      await nextTick();
      await nextTick();

      const select = wrapper.find('select');
      expect(select.element.value).toBe('');
    });
  });

  describe('Late prop arrival', () => {
    it('should update selection when selectedSeriesId prop changes', async () => {
      wrapper = createWrapper({ selectedSeriesId: null });

      await nextTick();
      await nextTick();

      // Verify initially None is selected
      let select = wrapper.find('select');
      expect(select.element.value).toBe('');

      // Simulate parent updating the prop after async loading
      await wrapper.setProps({ selectedSeriesId: 'series-1' });
      await nextTick();

      select = wrapper.find('select');
      expect(select.element.value).toBe('series-1');
    });
  });

  describe('Selection change emits', () => {
    it('should emit seriesChanged with series ID when a series is selected', async () => {
      wrapper = createWrapper({ selectedSeriesId: null });

      await nextTick();
      await nextTick();

      const select = wrapper.find('select');
      await select.setValue('series-1');

      const emitted = wrapper.emitted('seriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toBe('series-1');
    });

    it('should emit seriesChanged with null when None is selected', async () => {
      wrapper = createWrapper({ selectedSeriesId: 'series-2' });

      await nextTick();
      await nextTick();

      const select = wrapper.find('select');
      await select.setValue('');

      const emitted = wrapper.emitted('seriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[0][0]).toBeNull();
    });
  });

  describe('Calendar ID change reloads series', () => {
    it('should reload series when calendarId prop changes', async () => {
      wrapper = createWrapper({ calendarId: 'calendar-123' });

      await nextTick();
      await nextTick();

      // Verify initial load
      expect(mockLoadSeries).toHaveBeenCalledWith('calendar-123');
      expect(mockLoadSeries).toHaveBeenCalledTimes(1);

      // Change calendarId
      await wrapper.setProps({ calendarId: 'calendar-456' });
      await nextTick();
      await nextTick();

      expect(mockLoadSeries).toHaveBeenCalledWith('calendar-456');
      expect(mockLoadSeries).toHaveBeenCalledTimes(2);
    });
  });

  describe('Loading state', () => {
    it('should show loading message while series are loading', async () => {
      // Never resolves — series stay loading
      mockLoadSeries = vi.fn().mockReturnValue(new Promise(() => {}));
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockImplementation(mockLoadSeries);

      wrapper = createWrapper();
      await nextTick();

      const loading = wrapper.find('.loading');
      expect(loading.exists()).toBe(true);
    });
  });

  describe('Error state', () => {
    it('should show error when loading fails', async () => {
      mockLoadSeries = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockImplementation(mockLoadSeries);

      wrapper = createWrapper();

      await nextTick();
      await nextTick();

      const error = wrapper.find('.error');
      expect(error.exists()).toBe(true);
    });
  });

  describe('Accessibility', () => {
    it('should have an accessible label associated with the select', async () => {
      wrapper = createWrapper();

      await nextTick();
      await nextTick();

      const select = wrapper.find('select');
      const label = wrapper.find('label');
      expect(select.exists()).toBe(true);
      expect(label.exists()).toBe(true);
    });
  });

  describe('Inline series creation', () => {
    it('should render the "+ New series" button under the select', async () => {
      wrapper = createWrapper();
      await settle();

      const button = wrapper.find('[data-test="add-series-button"]');
      expect(button.exists()).toBe(true);
      expect(button.attributes('type')).toBe('button');
    });

    it('should render the button when no series exist and drop the management help text', async () => {
      mockLoadSeries.mockResolvedValue([]);
      wrapper = createWrapper();
      await settle();

      expect(wrapper.find('[data-test="add-series-button"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain('calendar management');
    });

    it('should hide the button while loading', async () => {
      mockLoadSeries = vi.fn().mockReturnValue(new Promise(() => {}));
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockImplementation(mockLoadSeries);
      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.find('[data-test="add-series-button"]').exists()).toBe(false);
    });

    it('should hide the button in the error state', async () => {
      mockLoadSeries = vi.fn().mockRejectedValue(new Error('Network error'));
      vi.spyOn(SeriesService.prototype, 'loadSeries').mockImplementation(mockLoadSeries);
      wrapper = createWrapper();
      await settle();

      expect(wrapper.find('[data-test="add-series-button"]').exists()).toBe(false);
    });

    it('should mount the create modal with a fresh series scoped to the calendar', async () => {
      wrapper = createWrapper();
      await settle();

      expect(wrapper.findComponent(CreateSeriesModal).exists()).toBe(false);

      const modal = await openModal(wrapper);
      const seriesProp = modal.props('series') as EventSeries;
      expect(seriesProp.calendarId).toBe('calendar-123');
      expect(seriesProp.id).toBeFalsy();
      expect(seriesProp.urlName).toBe('');
      expect(seriesProp.getLanguages()).toContain('en');
    });

    it('should add the saved series as an option, select it, and emit seriesChanged', async () => {
      wrapper = createWrapper({ selectedSeriesId: 'series-1' });
      await settle();

      const modal = await openModal(wrapper);
      const newSeries = createTestSeries('series-new', 'Winter Market');

      modal.vm.$emit('saved', newSeries);
      await nextTick();

      const options = wrapper.findAll('option');
      expect(options.length).toBe(5);
      expect(options.some((o: any) => o.attributes('value') === 'series-new' && o.text() === 'Winter Market')).toBe(true);
      expect(wrapper.find('select').element.value).toBe('series-new');

      const emitted = wrapper.emitted('seriesChanged');
      expect(emitted).toBeTruthy();
      expect(emitted[emitted.length - 1][0]).toBe('series-new');

      // Still mounted until the modal itself emits close
      expect(wrapper.findComponent(CreateSeriesModal).exists()).toBe(true);
      modal.vm.$emit('close');
      await nextTick();
      expect(wrapper.findComponent(CreateSeriesModal).exists()).toBe(false);
      expect(wrapper.find('select').element.value).toBe('series-new');
    });

    it('should not duplicate the option when the store already appended the saved series', async () => {
      wrapper = createWrapper();
      await settle();

      const modal = await openModal(wrapper);
      const newSeries = createTestSeries('series-new', 'Winter Market');
      // Simulate SeriesService.saveSeries having pushed into the same array
      // reference the selector holds.
      (wrapper.vm.state.availableSeries as EventSeries[]).push(newSeries);

      modal.vm.$emit('saved', newSeries);
      await nextTick();

      const matches = wrapper.findAll('option').filter((o: any) => o.attributes('value') === 'series-new');
      expect(matches.length).toBe(1);
    });

    it('should return focus to the button after the modal closes', async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      wrapper = createWrapper({}, host);
      await settle();

      const modal = await openModal(wrapper);
      modal.vm.$emit('close');
      await settle();

      expect(document.activeElement).toBe(wrapper.find('[data-test="add-series-button"]').element);
      host.remove();
    });

    it('should not emit seriesChanged when the modal closes without saving', async () => {
      wrapper = createWrapper();
      await settle();

      const modal = await openModal(wrapper);
      modal.vm.$emit('close');
      await nextTick();

      expect(wrapper.emitted('seriesChanged')).toBeFalsy();
      expect(wrapper.findComponent(CreateSeriesModal).exists()).toBe(false);
    });
  });
});
