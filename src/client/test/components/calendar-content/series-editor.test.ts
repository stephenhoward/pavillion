import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import SeriesEditor from '@/client/components/logged_in/calendar-content/series-editor.vue';
import SeriesService from '@/client/service/series';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { DuplicateSeriesNameError } from '@/common/exceptions/series';

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
        methods: {
          panelId(lang: string) { return `stub-${lang}-panel`; },
          tabId(lang: string) { return `stub-${lang}-tab`; },
        },
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

  describe('alt text editor', () => {
    it('is absent while the series has no image to describe', async () => {
      wrapper = createWrapper(createSeries(null));
      await nextTick();

      expect(wrapper.find('.image-alt-editor').exists()).toBe(false);
    });

    it('is offered once the series has an image', async () => {
      wrapper = createWrapper(createSeries('media-abc-123'));
      await nextTick();

      expect(wrapper.find('.image-alt-editor').exists()).toBe(true);
    });

    it('appears as soon as an upload gives the series an image', async () => {
      wrapper = createWrapper(createSeries(null));
      await nextTick();

      wrapper.vm.handleImageUpload([{ success: true, media: { id: 'new-media-id' } }]);
      await nextTick();

      expect(wrapper.find('.image-alt-editor').exists()).toBe(true);
    });

    it('edits the alt text of the language the editor is showing', async () => {
      const series = createSeries('media-abc-123');
      series.content('en').imageAlt = 'A band on an outdoor stage';

      wrapper = createWrapper(series);
      await nextTick();

      // The editor has no language selector of its own: it follows the tab
      // selection in the details section and writes onto the working model,
      // which is what the Save button then sends.
      const textarea = wrapper.find('.image-alt-editor textarea');
      expect((textarea.element as HTMLTextAreaElement).value).toBe('A band on an outdoor stage');

      await textarea.setValue('A brass band playing to a seated crowd');
      expect(series.content('en').imageAlt).toBe('A brass band playing to a seated crowd');
    });

    it('clears the alt text in every language when an upload replaces the image', async () => {
      const series = createSeries('media-abc-123');
      series.addContent(EventSeriesContent.fromObject({ language: 'fr', name: 'Série d\'été', description: '' }));
      series.content('en').imageAlt = 'A band on an outdoor stage';
      series.content('fr').imageAlt = 'Un orchestre sur une scène en plein air';

      wrapper = createWrapper(series);
      await nextTick();

      // The upload zone is offered whether or not the series already has an
      // image, so this is the replace path: the description belonged to the
      // photograph being replaced, and saved against the new one it would tell
      // a screen-reader user about something the image does not show.
      wrapper.vm.handleImageUpload([{ success: true, media: { id: 'new-media-id' } }]);
      await nextTick();

      expect(series.mediaId).toBe('new-media-id');
      expect(series.content('en').imageAlt).toBe('');
      expect(series.content('fr').imageAlt).toBe('');

      // And the editor follows the model: Decorative for the new image, not
      // Describe with an empty box.
      const editor = wrapper.find('.image-alt-editor');
      expect(editor.exists()).toBe(true);
      expect(editor.find('textarea').exists()).toBe(false);
      expect((editor.findAll('input[type="radio"]')[0].element as HTMLInputElement).checked).toBe(true);
    });

    it('leaves the alt text alone when the same image is uploaded again', async () => {
      const series = createSeries('media-abc-123');
      series.content('en').imageAlt = 'A band on an outdoor stage';

      wrapper = createWrapper(series);
      await nextTick();

      wrapper.vm.handleImageUpload([{ success: true, media: { id: 'media-abc-123' } }]);
      await nextTick();

      // Nothing changed about the image, so nothing changes about its
      // description.
      expect(series.content('en').imageAlt).toBe('A band on an outdoor stage');
    });

    it('follows the language tab chosen in the details section', async () => {
      const series = createSeries('media-abc-123');
      series.addContent(EventSeriesContent.fromObject({ language: 'fr', name: 'S\u00e9rie d\'\u00e9t\u00e9', description: '' }));
      series.content('en').imageAlt = 'A band on an outdoor stage';
      series.content('fr').imageAlt = 'Un orchestre sur une sc\u00e8ne en plein air';

      wrapper = createWrapper(series);
      await nextTick();

      const textarea = () => wrapper.find('.image-alt-editor textarea');
      expect((textarea().element as HTMLTextAreaElement).value).toBe('A band on an outdoor stage');

      // The tabs live in the details form, not here: the editor only learns
      // about the switch because the form announces it. Without that the alt
      // text would stay on whatever language the editor started on while the
      // fields above it moved.
      await wrapper.findComponent('.language-tab-stub').vm.$emit('update:modelValue', 'fr');
      await nextTick();

      expect((textarea().element as HTMLTextAreaElement).value).toBe('Un orchestre sur une sc\u00e8ne en plein air');

      await textarea().setValue('Un orchestre de cuivres');
      expect(series.content('fr').imageAlt).toBe('Un orchestre de cuivres');
      expect(series.content('en').imageAlt).toBe('A band on an outdoor stage');
    });
  });
});

describe('SeriesEditor — save flow', () => {
  let wrapper: any;
  let mockSave: any;

  beforeEach(() => {
    mockSave = vi.fn().mockResolvedValue(createSeries());
    vi.spyOn(SeriesService.prototype, 'saveSeries').mockImplementation(mockSave);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.restoreAllMocks();
  });

  it('should disable the save button until the details form reports it can save', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();

    const saveButton = wrapper.find('.btn-save');
    expect(saveButton.attributes('disabled')).toBeDefined();

    await wrapper.find('#series-url-name').setValue('fall-expo');
    await wrapper.find('#name-en').setValue('Fall Expo');

    expect(saveButton.attributes('disabled')).toBeUndefined();
  });

  it('should save the series and emit saved then close', async () => {
    const series = createSeries();
    wrapper = createWrapper(series);
    await nextTick();

    await wrapper.find('.btn-save').trigger('click');
    await nextTick();
    await nextTick();

    expect(mockSave).toHaveBeenCalledWith(series);
    const saved = wrapper.emitted('saved');
    expect(saved).toBeTruthy();
    expect((saved[0][0] as EventSeries).id).toBe('series-1');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('should show the mapped error and stay open when the save fails', async () => {
    mockSave.mockRejectedValue(new DuplicateSeriesNameError());
    wrapper = createWrapper(createSeries());
    await nextTick();

    await wrapper.find('.btn-save').trigger('click');
    await nextTick();
    await nextTick();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('A series with this name already exists');
    expect(wrapper.emitted('saved')).toBeFalsy();
    expect(wrapper.emitted('close')).toBeFalsy();
  });
});
