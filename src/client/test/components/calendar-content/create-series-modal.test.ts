import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import CreateSeriesModal from '@/client/components/logged_in/calendar-content/create-series-modal.vue';
import SeriesService from '@/client/service/series';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { DuplicateSeriesNameError, SeriesUrlNameAlreadyExistsError } from '@/common/exceptions/series';

function createNewSeries(): EventSeries {
  const series = new EventSeries(null, 'calendar-123', '', null);
  series.addContent(EventSeriesContent.fromObject({ language: 'en', name: '', description: '' }));
  return series;
}

function createSavedSeries(): EventSeries {
  const series = new EventSeries('series-new', 'calendar-123', 'fall-expo', null);
  series.addContent(EventSeriesContent.fromObject({ language: 'en', name: 'Fall Expo', description: '' }));
  return series;
}

const stubs = {
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
};

const createWrapper = (series: EventSeries) => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes: [] });
  return mountComponent(CreateSeriesModal, router, { props: { series }, stubs });
};

async function fillValidForm(wrapper: any) {
  await wrapper.find('#series-url-name').setValue('fall-expo');
  await wrapper.find('#name-en').setValue('Fall Expo');
}

describe('CreateSeriesModal', () => {
  let wrapper: any;
  let mockSave: any;

  beforeEach(() => {
    mockSave = vi.fn().mockResolvedValue(createSavedSeries());
    vi.spyOn(SeriesService.prototype, 'saveSeries').mockImplementation(mockSave);
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  it('should render the add-series title and the details form without an image uploader', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    expect(wrapper.text()).toContain('Add a Series');
    expect(wrapper.find('#series-url-name').exists()).toBe(true);
    expect(wrapper.find('.image-upload-stub').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'ImageUpload' }).exists()).toBe(false);
  });

  it('should disable the create button until the form is valid', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    const button = wrapper.find('[data-test="create-series-submit"]');
    expect(button.attributes('disabled')).toBeDefined();

    await fillValidForm(wrapper);
    expect(button.attributes('disabled')).toBeUndefined();
  });

  it('should save the series and emit saved then close', async () => {
    const series = createNewSeries();
    wrapper = createWrapper(series);
    await nextTick();
    await fillValidForm(wrapper);

    await wrapper.find('[data-test="create-series-submit"]').trigger('click');
    await nextTick();
    await nextTick();

    expect(mockSave).toHaveBeenCalledWith(series);
    const saved = wrapper.emitted('saved');
    expect(saved).toBeTruthy();
    expect((saved[0][0] as EventSeries).id).toBe('series-new');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('should submit when the form emits submit', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    await fillValidForm(wrapper);

    await wrapper.find('#name-en').trigger('keyup.enter');
    await nextTick();
    await nextTick();

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('should show the duplicate name error and stay open', async () => {
    mockSave.mockRejectedValue(new DuplicateSeriesNameError());
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    await fillValidForm(wrapper);

    await wrapper.find('[data-test="create-series-submit"]').trigger('click');
    await nextTick();
    await nextTick();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain('A series with this name already exists');
    expect(wrapper.emitted('saved')).toBeFalsy();
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('should show the duplicate url name error', async () => {
    mockSave.mockRejectedValue(new SeriesUrlNameAlreadyExistsError());
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    await fillValidForm(wrapper);

    await wrapper.find('[data-test="create-series-submit"]').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('[role="alert"]').text()).toContain('A series with this URL name already exists');
  });

  it('should emit close when cancelled', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    await wrapper.find('[data-test="create-series-cancel"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
