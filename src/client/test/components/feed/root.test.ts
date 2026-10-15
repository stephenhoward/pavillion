import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import Root from '@/client/components/logged_in/feed/root.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFeedStore } from '@/client/stores/feedStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import CalendarService from '@/client/service/calendar';
import FeedService from '@/client/service/feed';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar';

const Stub = { template: '<div />' };
const viewStubs = { FollowsView: true, FollowersView: true, FollowedEventsView: true, AddCalendarModal: true };

describe('Feed Root', () => {
  let sandbox: sinon.SinonSandbox;
  let pinia: Pinia;
  let router: Router;
  let getFeed: sinon.SinonStub;
  let getFollows: sinon.SinonStub;
  let getFollowers: sinon.SinonStub;

  /** Every FeedService request, flattened to the calendar ID it was made for. */
  const requestedCalendarIds = () => [getFeed, getFollows, getFollowers]
    .flatMap((stub) => stub.getCalls().map((call) => call.args[0]));

  beforeEach(async () => {
    localStorage.removeItem(CURRENT_CALENDAR_STORAGE_KEY);
    sandbox = sinon.createSandbox();
    pinia = createPinia();
    setActivePinia(pinia);

    const infos = [
      new CalendarInfo(new Calendar('o1', 'first'), 'owner'),
      new CalendarInfo(new Calendar('o2', 'second'), 'owner'),
    ];
    useCalendarStore().setCalendarInfos(infos);
    sandbox.stub(CalendarService.prototype, 'ensureCalendarsLoaded').resolves(infos);

    getFeed = sandbox.stub(FeedService.prototype, 'getFeed').resolves({ events: [], hasMore: false });
    getFollows = sandbox.stub(FeedService.prototype, 'getFollows').resolves([]);
    getFollowers = sandbox.stub(FeedService.prototype, 'getFollowers').resolves([]);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/feed/:calendar', component: Stub, name: 'feed' },
        { path: '/calendar', component: Stub, name: 'calendars' },
      ],
    });
  });

  afterEach(() => {
    sandbox.restore();
    localStorage.removeItem(CURRENT_CALENDAR_STORAGE_KEY);
  });

  const mountAt = async (path: string) => {
    await router.push(path);
    const wrapper = mountComponent(Root, router, { pinia, stubs: viewStubs });
    await flushPromises();
    return wrapper;
  };

  it('keeps the feed-root class', async () => {
    const wrapper = await mountAt('/feed/first');
    expect(wrapper.find('.feed-root').exists()).toBe(true);
  });

  it('shows the switcher in the header with the route calendar', async () => {
    const wrapper = await mountAt('/feed/first');
    const trigger = wrapper.find('header h1 button[aria-haspopup="dialog"]');
    expect(trigger.text()).toContain('first');
    expect(trigger.attributes('aria-label')).toBe('Switch calendar: first');
  });

  it('loads the feed for the route calendar', async () => {
    await mountAt('/feed/first');
    expect(getFeed.calledWith('o1')).toBe(true);
    expect(getFollows.calledWith('o1')).toBe(true);
    expect(getFollowers.calledWith('o1')).toBe(true);
    expect(useCalendarStore().selectedCalendarId).toBe('o1');
  });

  it('clears feed data and reloads when the calendar param changes', async () => {
    const wrapper = await mountAt('/feed/first');
    const clear = sandbox.spy(useFeedStore(), 'clearFeedData');

    await router.push('/feed/second');
    await flushPromises();

    sinon.assert.called(clear);
    expect(getFeed.lastCall.args[0]).toBe('o2');
    expect(useCalendarStore().selectedCalendarId).toBe('o2');
    expect(wrapper.find('h1 button[aria-haspopup="dialog"]').text()).toContain('second');
  });

  it('never sends a stale persisted ID to the feed service', async () => {
    useCalendarStore().selectedCalendarId = 'stale-id';

    await mountAt('/feed/first');

    expect(requestedCalendarIds().length).toBeGreaterThan(0);
    expect(requestedCalendarIds().every((id) => id === 'o1')).toBe(true);
  });

  it('unknown :calendar triggers no FeedService call', async () => {
    // A previously selected calendar must not be used as a fallback.
    useCalendarStore().selectedCalendarId = 'o1';

    const wrapper = await mountAt('/feed/not-mine');

    expect(requestedCalendarIds()).toEqual([]);
    expect(wrapper.find('[role="alert"]').text()).toContain('not-mine');
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  });

  it('requests nothing and claims no not-found when the calendars fail to load', async () => {
    (CalendarService.prototype.ensureCalendarsLoaded as sinon.SinonStub).rejects(new Error('network'));

    const wrapper = await mountAt('/feed/first');

    expect(requestedCalendarIds()).toEqual([]);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('has no calendar dropdown or select prompt', async () => {
    const wrapper = await mountAt('/feed/first');
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('.no-calendar-selected').exists()).toBe(false);
  });

  it('switches tabs', async () => {
    const wrapper = await mountAt('/feed/first');
    expect(wrapper.vm.state.activeTab).toBe('events');

    await wrapper.findAll('button[role="tab"]')[2].trigger('click');

    expect(wrapper.vm.state.activeTab).toBe('followers');
    expect(wrapper.find('#followers-panel').attributes('hidden')).toBeUndefined();
  });

  it('opens and closes the add calendar modal without switching tabs', async () => {
    const wrapper = await mountAt('/feed/first');

    await wrapper.vm.handleFollowCalendarRequest();
    expect(wrapper.vm.state.activeTab).toBe('events');
    expect(wrapper.vm.showAddCalendarModal).toBe(true);

    await wrapper.vm.handleCloseAddCalendarModal();
    expect(wrapper.vm.showAddCalendarModal).toBe(false);
  });
});
