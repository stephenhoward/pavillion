import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import sinon from 'sinon';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import AddCalendarModal from '../add_calendar_modal.vue';
import { useFeedStore } from '@/client/stores/feedStore';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import FeedService from '@/client/service/feed';

const i18nResources = {
  en: {
    feed: {
      add_calendar_modal: {
        title: 'Add a Calendar',
        mapping_step_title: 'Set up category mappings (optional)',
        mapping_step_description: 'Map categories from this calendar to your own for automatic categorization of reposted events.',
        identifier_label: 'Calendar Identifier',
        identifier_placeholder: 'calendar@domain.com',
        identifier_help: 'Enter the ActivityPub identifier of the calendar you want to follow',
        looking_up: 'Looking up calendar...',
        lookup_error: 'Could not find calendar. Please check the identifier and try again.',
        self_follow_error: 'A calendar cannot follow itself.',
        follow_error: 'Failed to follow calendar. Please try again.',
        preview_title: 'Calendar Preview',
        preview_name: 'Name',
        preview_description: 'Description',
        preview_domain: 'Domain',
        policy_title: 'Auto-Repost Settings',
        policy_description: 'Choose whether to automatically share events from this calendar',
        auto_repost_originals: 'Auto-repost original events',
        auto_repost_originals_help: 'Automatically share events posted by this calendar',
        auto_repost_reposts: 'Also auto-repost shared events',
        auto_repost_reposts_help: 'Also share events this calendar has reposted from others',
        cancel_button: 'Cancel',
        follow_button: 'Follow',
        following_button: 'Following...',
        mapping_save_button: 'Save mappings',
        mapping_saving_button: 'Saving...',
        mapping_skip_button: 'Skip for now',
      },
      errors: {
        InvalidRemoteCalendarIdentifierError: 'Invalid calendar identifier format.',
        SelfFollowError: 'A calendar cannot follow itself.',
        InsufficientCalendarPermissionsError: "You don't have permission.",
      },
    },
    calendars: {
      category_mapping: {
        no_mapping: 'No mapping',
        no_source_categories: 'Source calendar has no categories',
        dropdown_label: 'Map "{{name}}" to local category',
        group_label: 'Map source categories to local categories',
      },
    },
  },
};

describe('AddCalendarModal — mapping step', () => {
  let pinia: ReturnType<typeof createPinia>;
  let sandbox: sinon.SinonSandbox;

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);
    sandbox = sinon.createSandbox();

    const calendarStore = useCalendarStore();
    const calendar = new Calendar('cal-123', 'test-calendar');
    calendar.addContent({ language: 'en', title: 'Test Calendar' });
    calendarStore.setCalendars([calendar]);
    calendarStore.setSelectedCalendar('cal-123');

    await i18next.init({
      lng: 'en',
      fallbackLng: 'en',
      resources: i18nResources,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  function mountModal() {
    return mount(AddCalendarModal, {
      global: {
        plugins: [pinia, [I18NextVue, { i18next }]],
        stubs: {
          Modal: {
            template: '<div class="modal"><div class="modal-title">{{ title }}</div><slot /></div>',
            props: ['title'],
          },
          ToggleSwitch: true,
        },
      },
    });
  }

  it('does not show the mapping step initially', () => {
    const wrapper = mountModal();
    expect(wrapper.find('.mapping-step').exists()).toBe(false);
  });

  it('skips mapping step and closes dialog when source calendar has no categories', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');

    sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves([]);
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);

    const wrapper = mountModal();

    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.mapping-step').exists()).toBe(false);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('shows mapping step when source calendar has categories', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');

    sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves([
      { id: 'src-1', name: 'Music' },
      { id: 'src-2', name: 'Sports' },
    ]);
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([
      { id: 'loc-1', name: 'Arts' },
    ]);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.mapping-step').exists()).toBe(true);
    // The modal title should switch to the mapping step title
    expect(wrapper.find('.modal-title').text()).toBe('Set up category mappings (optional)');
  });

  it('shows skip and save buttons during mapping step', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');

    sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves([
      { id: 'src-1', name: 'Music' },
    ]);
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll('button');
    const buttonTexts = buttons.map((b) => b.text());
    expect(buttonTexts).toContain('Skip for now');
    expect(buttonTexts).toContain('Save mappings');
  });

  it('closes dialog when skip button is clicked without calling setCategoryMappings', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');

    sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves([
      { id: 'src-1', name: 'Music' },
    ]);
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);

    const setCategoryMappingsSpy = sandbox.stub(FeedService.prototype, 'setCategoryMappings').resolves([]);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    // Find and click the skip button
    const buttons = wrapper.findAll('button');
    const skipButton = buttons.find((b) => b.text() === 'Skip for now');
    expect(skipButton).toBeTruthy();
    await skipButton!.trigger('click');
    await wrapper.vm.$nextTick();

    expect(setCategoryMappingsSpy.called).toBe(false);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('saves mappings and closes dialog when save button is clicked', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');

    sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves([
      { id: 'src-1', name: 'Music' },
    ]);
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([
      { id: 'loc-1', name: 'Arts' },
    ]);

    const setCategoryMappingsSpy = sandbox.stub(FeedService.prototype, 'setCategoryMappings').resolves([]);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    // Find and click the save button
    const buttons = wrapper.findAll('button');
    const saveButton = buttons.find((b) => b.text() === 'Save mappings');
    expect(saveButton).toBeTruthy();
    await saveButton!.trigger('click');
    await wrapper.vm.$nextTick();

    expect(setCategoryMappingsSpy.calledOnce).toBe(true);
    expect(setCategoryMappingsSpy.firstCall.args[0]).toBe('cal-123');
    expect(setCategoryMappingsSpy.firstCall.args[1]).toBe('actor@remote.com');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('closes dialog when follow returns no calendarActorId', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves(null);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.mapping-step').exists()).toBe(false);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('emits follow-success after successful follow regardless of mapping step', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');
    sandbox.stub(FeedService.prototype, 'getSourceCategories').resolves([]);
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('follow-success')).toBeTruthy();
  });

  it('falls back to close when getSourceCategories throws an error', async () => {
    const feedStore = useFeedStore();
    sandbox.stub(feedStore, 'followCalendar').resolves('actor@remote.com');
    sandbox.stub(FeedService.prototype, 'getSourceCategories').rejects(new Error('Network error'));
    sandbox.stub(FeedService.prototype, 'getCalendarCategories').resolves([]);

    const wrapper = mountModal();
    wrapper.vm.preview = { name: 'Test', domain: 'remote.com', actorUrl: 'https://remote.com/u/test' };
    await wrapper.vm.$nextTick();
    await wrapper.vm.handleFollow();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.mapping-step').exists()).toBe(false);
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
