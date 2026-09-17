import { describe, it, expect, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { nextTick } from 'vue';
import { mountComponent } from '@/client/test/lib/vue';
import SeriesDetailsForm from '@/client/components/logged_in/calendar-content/series-details-form.vue';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

function createExistingSeries(): EventSeries {
  const series = new EventSeries('series-1', 'calendar-123', 'summer-series', null);
  series.addContent(EventSeriesContent.fromObject({ language: 'en', name: 'Summer Series', description: '' }));
  return series;
}

function createNewSeries(): EventSeries {
  const series = new EventSeries(null, 'calendar-123', '', null);
  series.addContent(EventSeriesContent.fromObject({ language: 'en', name: '', description: '' }));
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

const createWrapper = (series: EventSeries, attachTo?: Element) => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes: [] });
  return mountComponent(SeriesDetailsForm, router, {
    props: { series, disabled: false },
    stubs,
    ...(attachTo ? { attachTo } : {}),
  });
};

describe('SeriesDetailsForm', () => {
  let wrapper: any;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('should show the URL name field for a new series', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    expect(wrapper.find('#series-url-name').exists()).toBe(true);
  });

  it('should hide the URL name field for an existing series', async () => {
    wrapper = createWrapper(createExistingSeries());
    await nextTick();
    expect(wrapper.find('#series-url-name').exists()).toBe(false);
  });

  it('should report canSave false for a new series until url name and name are filled', async () => {
    const series = createNewSeries();
    wrapper = createWrapper(series);
    await nextTick();

    expect(wrapper.vm.canSave()).toBe(false);

    await wrapper.find('#series-url-name').setValue('fall-expo');
    expect(wrapper.vm.canSave()).toBe(false);

    await wrapper.find('#name-en').setValue('Fall Expo');
    expect(wrapper.vm.canSave()).toBe(true);
    expect(series.urlName).toBe('fall-expo');
    expect(series.content('en').name).toBe('Fall Expo');
  });

  it('should report canSave true for an existing series with a name and no url name field', async () => {
    wrapper = createWrapper(createExistingSeries());
    await nextTick();
    expect(wrapper.vm.canSave()).toBe(true);
  });

  it('should emit submit when Enter is pressed in the name field', async () => {
    wrapper = createWrapper(createExistingSeries());
    await nextTick();
    await wrapper.find('#name-en').trigger('keyup.enter');
    expect(wrapper.emitted('submit')).toBeTruthy();
  });

  it('should disable the inputs when disabled is set', async () => {
    wrapper = createWrapper(createNewSeries());
    await wrapper.setProps({ disabled: true });
    expect((wrapper.find('#name-en').element as HTMLInputElement).disabled).toBe(true);
    expect((wrapper.find('#series-url-name').element as HTMLInputElement).disabled).toBe(true);
  });

  it('should focus the URL name input on mount for a new series', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    wrapper = createWrapper(createNewSeries(), host);
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('#series-url-name').element);
    host.remove();
  });

  it('should focus the name input on mount for an existing series', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    wrapper = createWrapper(createExistingSeries(), host);
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(wrapper.find('#name-en').element);
    host.remove();
  });

  it('should mark the first field autofocus so a host dialog leaves focus there', async () => {
    wrapper = createWrapper(createNewSeries());
    await nextTick();
    expect(wrapper.find('#series-url-name').attributes('autofocus')).toBeDefined();
    expect(wrapper.find('#name-en').attributes('autofocus')).toBeUndefined();

    wrapper.unmount();
    wrapper = createWrapper(createExistingSeries());
    await nextTick();
    expect(wrapper.find('#name-en').attributes('autofocus')).toBeDefined();
  });

  it('should add content for a newly picked language', async () => {
    const series = createNewSeries();
    wrapper = createWrapper(series);
    await nextTick();

    wrapper.findComponent('.language-tab-stub').vm.$emit('add-language');
    await nextTick();
    const picker = wrapper.findComponent('.language-picker-stub');
    expect(picker.exists()).toBe(true);

    picker.vm.$emit('select', 'fr');
    await nextTick();
    expect(series.getLanguages()).toContain('fr');
    expect(wrapper.find('.language-picker-stub').exists()).toBe(false);
  });
});
