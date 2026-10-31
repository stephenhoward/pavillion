import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { createPinia, setActivePinia } from 'pinia';
import FeedService, { FollowRelationship } from '@/client/service/feed';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFeedStore } from '@/client/stores/feedStore';
import { useFeedFollows } from '@/client/composables/useFeedFollows';

const follow = (id: string, calendarActorUuid: string): FollowRelationship => ({
  id,
  calendarActorId: `${id}@remote.example`,
  calendarActorUuid,
  calendarId: 'cal-a',
  autoRepostOriginals: false,
  autoRepostReposts: false,
});

/** A promise plus the function that resolves it, for holding a request in flight. */
function deferred<T = unknown>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe('useFeedFollows', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    setActivePinia(createPinia());
    useCalendarStore().selectedCalendarId = 'cal-a';
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('followCalendar', () => {
    it('follows and reloads for the calendar selected when it was called, even after a switch', async () => {
      useFeedStore().setFollows([follow('existing', 'uuid-existing')]);
      const post = sandbox.stub(FeedService.prototype, 'followCalendar').callsFake(async () => {
        // The user switches calendars while the follow request is in flight.
        useCalendarStore().selectedCalendarId = 'cal-b';
      });
      const getFollows = sandbox.stub(FeedService.prototype, 'getFollows')
        .resolves([follow('existing', 'uuid-existing'), follow('new', 'uuid-new')]);

      const { followCalendar } = useFeedFollows();
      const result = await followCalendar('cal@remote.example');

      expect(post.firstCall.args[0]).toBe('cal-a');
      expect(getFollows.firstCall.args[0]).toBe('cal-a');
      // The store write is dropped for the switched-away calendar, so the new
      // follow is found in the reloaded list rather than in the store.
      expect(useFeedStore().follows).toEqual([follow('existing', 'uuid-existing')]);
      expect(result).toBe('uuid-new');
    });
  });

  describe('loadFollows', () => {
    it('keeps isLoading set when an older request finishes before the newer one', async () => {
      const first = deferred<FollowRelationship[]>();
      const second = deferred<FollowRelationship[]>();
      const load = sandbox.stub(FeedService.prototype, 'loadFollows');
      load.withArgs('cal-a').returns(first.promise);
      load.withArgs('cal-b').returns(second.promise);
      const { isLoading, loadFollows } = useFeedFollows();

      const pendingFirst = loadFollows();
      useCalendarStore().selectedCalendarId = 'cal-b';
      const pendingSecond = loadFollows();

      first.resolve([]);
      await pendingFirst;
      expect(isLoading.value).toBe(true);

      second.resolve([]);
      await pendingSecond;
      expect(isLoading.value).toBe(false);
    });
  });
});
