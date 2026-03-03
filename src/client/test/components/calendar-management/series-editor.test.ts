import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import SeriesEditor from '@/client/components/logged_in/calendar-management/series-editor.vue';
import SeriesService from '@/client/service/series';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar/manage', component: {}, name: 'manage' },
];

function createSeries(mediaId: string | null = null): EventSeries {
  const series = new EventSeries('series-1', 'calendar-123', 'summer-series', mediaId);
  series.addContent(EventSeriesContent.fromObject({ language: 'en', name: 'Summer Series', description: '' }));
  return series;
}

function createNewSeries(): EventSeries {
  const series = new EventSeries(null, 'calendar-123', '', null);
  series.addContent(EventSeriesContent.fromObject({ language: 'en', name: '', description: '' }));
  return series;
}

const createWrapper = (series: EventSeries) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  return mountComponent(SeriesEditor, router, {
    props: { series },
    stubs: {
      // Stub child components that make API calls to keep tests fast and focused
      EventImage: {
        template: '<div class="event-image-stub" :data-media-id="media?.id"></div>',
        props: ['media', 'size'],
      },
      ImageUpload: {
        template: '<div class="image-upload-stub"></div>',
        props: ['calendarId', 'multiple', 'ariaLabel'],
        emits: ['upload-complete', 'files-changed'],
      },
      LanguageTabSelector: {
        template: '<div class="language-tab-stub"></div>',
        props: ['modelValue', 'languages', 'erroredTabs'],
        emits: ['update:modelValue', 'add-language', 'remove-language'],
      },
      LanguagePicker: {
        template: '<div class="language-picker-stub"></div>',
        props: ['languages', 'selectedLanguages'],
        emits: ['select', 'close'],
      },
    },
  });
};

describe('SeriesEditor — image section', () => {
  let wrapper: any;

  beforeEach(() => {
    vi.spyOn(SeriesService.prototype, 'saveSeries').mockResolvedValue(createSeries());
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  describe('existing image display', () => {
    it('shows current image section when series has a mediaId', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(true);
      expect(wrapper.find('.event-image-stub').exists()).toBe(true);
    });

    it('passes the mediaId to EventImage', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      const eventImage = wrapper.find('.event-image-stub');
      expect(eventImage.attributes('data-media-id')).toBe('media-abc-123');
    });

    it('shows the Current Image label', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      const imageSection = wrapper.find('.current-image-section');
      expect(imageSection.text()).toContain('Current Image');
    });

    it('does not show current image section when series has no mediaId', async () => {
      wrapper = createWrapper(createSeries(null));
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(false);
      expect(wrapper.find('.event-image-stub').exists()).toBe(false);
    });

    it('does not show current image section for a new series', async () => {
      wrapper = createWrapper(createNewSeries());
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(false);
    });
  });

  describe('upload toggle behaviour', () => {
    it('hides the current image section when a file is selected', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(true);

      wrapper.vm.handleFilesChanged([{ name: 'photo.jpg' }]);
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(false);
    });

    it('restores the current image section when the file selection is cleared', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      wrapper.vm.handleFilesChanged([{ name: 'photo.jpg' }]);
      await nextTick();
      expect(wrapper.find('.current-image-section').exists()).toBe(false);

      wrapper.vm.handleFilesChanged([]);
      await nextTick();
      expect(wrapper.find('.current-image-section').exists()).toBe(true);
    });

    it('upload zone is always rendered regardless of mediaId', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      expect(wrapper.find('.image-upload-stub').exists()).toBe(true);
    });
  });

  describe('handleImageUpload', () => {
    it('updates localSeries.mediaId on successful upload', async () => {
      wrapper = createWrapper(createSeries(null));
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(false);

      wrapper.vm.handleImageUpload([{ success: true, media: { id: 'new-media-id' } }]);
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(true);
      expect(wrapper.find('.event-image-stub').attributes('data-media-id')).toBe('new-media-id');
    });

    it('does not update mediaId when upload result is not successful', async () => {
      wrapper = createWrapper(createSeries(null));
      await nextTick();

      wrapper.vm.handleImageUpload([{ success: false, media: null }]);
      await nextTick();

      expect(wrapper.find('.current-image-section').exists()).toBe(false);
    });

    it('does not update mediaId for empty results', async () => {
      wrapper = createWrapper(createSeries('existing-id'));
      await nextTick();

      wrapper.vm.handleImageUpload([]);
      await nextTick();

      // Original mediaId unchanged
      expect(wrapper.find('.event-image-stub').attributes('data-media-id')).toBe('existing-id');
    });
  });
});
