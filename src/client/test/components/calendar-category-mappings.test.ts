import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import sinon from 'sinon';
import CalendarCategoryMappings from '@/client/components/logged_in/settings/calendar-category-mappings.vue';
import FeedService from '@/client/service/feed';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: {} }],
});

const TRANSLATIONS = {
  en: {
    calendars: {
      category_mapping: {
        no_mapping: 'No mapping',
        no_source_categories: 'Source calendar has no categories',
        dropdown_label: 'Map "{{name}}" to local category',
        group_label: 'Map source categories to local categories',
        page_title: 'Category Mappings',
        page_subtitle: 'Map categories from this followed calendar to your local categories.',
        loading: 'Loading category data...',
        load_error: 'Failed to load category data',
        save: 'Save mappings',
        saving: 'Saving...',
        save_success: 'Mappings saved',
        save_error: 'Failed to save mappings',
        category_mappings_link: 'Category mappings',
      },
    },
  },
};

const SOURCE_CATEGORIES = [
  { id: 'src-1', name: 'Music' },
  { id: 'src-2', name: 'Sports' },
];

const LOCAL_CATEGORIES = [
  { id: 'loc-1', name: 'Arts & Music' },
  { id: 'loc-2', name: 'Recreation' },
];

const EXISTING_MAPPINGS = [
  { sourceCategoryId: 'src-1', sourceCategoryName: 'Music', localCategoryId: 'loc-1' },
];

function mountPage(props: Record<string, string> = {}) {
  return mount(CalendarCategoryMappings, {
    global: {
      plugins: [router, [I18NextVue, { i18next }], createPinia()],
      stubs: {
        CategoryMappingEditor: {
          template: '<div class="category-mapping-editor-stub" />',
          props: ['sourceCategories', 'localCategories', 'modelValue'],
          emits: ['update:modelValue'],
        },
      },
    },
    props: {
      calendarId: 'cal-123',
      actorId: 'actor@remote.example',
      ...props,
    },
  });
}

describe('CalendarCategoryMappings', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    setActivePinia(createPinia());
    sandbox = sinon.createSandbox();

    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: TRANSLATIONS,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('loading state', () => {
    it('shows a loading message while data is being fetched', async () => {
      // Return a never-resolving promise to keep the loading state
      sandbox.stub(FeedService.prototype, 'getSourceCategories').returns(new Promise(() => {}));
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').returns(new Promise(() => {}));
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').returns(new Promise(() => {}));

      const wrapper = mountPage();

      expect(wrapper.find('.loading-state').exists()).toBe(true);
      expect(wrapper.find('.loading-state').text()).toContain('Loading category data...');
      wrapper.unmount();
    });

    it('hides loading state after data is fetched', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('.loading-state').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('error state', () => {
    it('shows an error message when data fails to load', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').rejects(new Error('network error'));
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves([]);

      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('.error-state').exists()).toBe(true);
      expect(wrapper.find('.error-state').text()).toContain('Failed to load category data');
      wrapper.unmount();
    });

    it('does not show mappings content when load fails', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').rejects(new Error('proxy error'));
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves([]);

      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('.mappings-content').exists()).toBe(false);
      wrapper.unmount();
    });
  });

  describe('loaded state', () => {
    it('renders the page title', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('h1').text()).toBe('Category Mappings');
      wrapper.unmount();
    });

    it('renders the CategoryMappingEditor component', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      const wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('.category-mapping-editor-stub').exists()).toBe(true);
      wrapper.unmount();
    });

    it('renders a save button', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      const wrapper = mountPage();
      await flushPromises();

      const saveBtn = wrapper.find('button.save-button');
      expect(saveBtn.exists()).toBe(true);
      expect(saveBtn.text()).toBe('Save mappings');
      wrapper.unmount();
    });
  });

  describe('save operation', () => {
    it('calls setCategoryMappings with correct arguments when save is clicked', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      const setMappingsStub = sandbox.stub(FeedService.prototype, 'setCategoryMappings').resolves([]);

      const wrapper = mountPage();
      await flushPromises();

      const saveBtn = wrapper.find('button.save-button');
      await saveBtn.trigger('click');
      await flushPromises();

      expect(setMappingsStub.calledOnce).toBe(true);
      const [calId, actId] = setMappingsStub.firstCall.args;
      expect(calId).toBe('cal-123');
      expect(actId).toBe('actor@remote.example');
      wrapper.unmount();
    });

    it('shows success message after a successful save', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);
      sandbox.stub(FeedService.prototype, 'setCategoryMappings').resolves([]);

      const wrapper = mountPage();
      await flushPromises();

      await wrapper.find('button.save-button').trigger('click');
      await flushPromises();

      const feedback = wrapper.find('.save-feedback.success');
      expect(feedback.exists()).toBe(true);
      expect(feedback.text()).toBe('Mappings saved');
      wrapper.unmount();
    });

    it('shows error message when save fails', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);
      sandbox.stub(FeedService.prototype, 'setCategoryMappings').rejects(new Error('server error'));

      const wrapper = mountPage();
      await flushPromises();

      await wrapper.find('button.save-button').trigger('click');
      await flushPromises();

      const feedback = wrapper.find('.save-feedback.error');
      expect(feedback.exists()).toBe(true);
      expect(feedback.text()).toBe('Failed to save mappings');
      wrapper.unmount();
    });

    it('disables the save button while saving', async () => {
      sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      let resolveSave: () => void;
      const savingPromise = new Promise<any>((resolve) => {
        resolveSave = () => resolve([]);
      });
      sandbox.stub(FeedService.prototype, 'setCategoryMappings').returns(savingPromise);

      const wrapper = mountPage();
      await flushPromises();

      const saveBtn = wrapper.find('button.save-button');
      expect(saveBtn.attributes('disabled')).toBeUndefined();

      await saveBtn.trigger('click');
      await wrapper.vm.$nextTick();

      expect(saveBtn.attributes('disabled')).toBeDefined();

      resolveSave!();
      await flushPromises();

      expect(saveBtn.attributes('disabled')).toBeUndefined();
      wrapper.unmount();
    });
  });

  describe('API calls on mount', () => {
    it('fetches source categories, local categories, and existing mappings on mount', async () => {
      const getSourceStub = sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves(SOURCE_CATEGORIES);
      const getLocalStub = sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves(LOCAL_CATEGORIES);
      const getMappingsStub = sandbox.stub(FeedService.prototype, 'getCategoryMappings').resolves(EXISTING_MAPPINGS);

      const wrapper = mountPage();
      await flushPromises();

      expect(getSourceStub.calledOnceWith('cal-123', 'actor@remote.example')).toBe(true);
      expect(getLocalStub.calledOnceWith('cal-123')).toBe(true);
      expect(getMappingsStub.calledOnceWith('cal-123', 'actor@remote.example')).toBe(true);
      wrapper.unmount();
    });
  });
});
