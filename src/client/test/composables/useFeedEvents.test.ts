import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { createPinia, setActivePinia } from 'pinia';
import FeedService from '@/client/service/feed';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useFeedEvents } from '@/client/composables/useFeedEvents';

/** A promise plus the functions that settle it, for holding a request in flight. */
function deferred<T = unknown>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useFeedEvents', () => {
  let sandbox: sinon.SinonSandbox;
  let loadFeed: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    setActivePinia(createPinia());
    useCalendarStore().selectedCalendarId = 'cal-a';
    loadFeed = sandbox.stub(FeedService.prototype, 'loadFeed');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('skips a second load for the same calendar while one is in flight', async () => {
    const first = deferred();
    loadFeed.returns(first.promise);
    const { loadFeed: load } = useFeedEvents();

    const pending = load();
    await load();

    expect(loadFeed.callCount).toBe(1);
    first.resolve({ events: [], hasMore: false });
    await pending;
  });

  it('starts a load for a different calendar while the previous one is in flight', async () => {
    const first = deferred();
    loadFeed.withArgs('cal-a').returns(first.promise);
    loadFeed.withArgs('cal-b').resolves({ events: [], hasMore: false });
    const { loadFeed: load } = useFeedEvents();

    const pending = load();
    useCalendarStore().selectedCalendarId = 'cal-b';
    await load();

    expect(loadFeed.getCalls().map((call) => call.args[0])).toEqual(['cal-a', 'cal-b']);
    first.resolve({ events: [], hasMore: false });
    await pending;
  });

  it('keeps isLoading set when an older request finishes before the newer one', async () => {
    const first = deferred();
    const second = deferred();
    loadFeed.withArgs('cal-a').returns(first.promise);
    loadFeed.withArgs('cal-b').returns(second.promise);
    const { isLoading, loadFeed: load } = useFeedEvents();

    const pendingFirst = load();
    useCalendarStore().selectedCalendarId = 'cal-b';
    const pendingSecond = load();

    first.resolve({ events: [], hasMore: false });
    await pendingFirst;
    expect(isLoading.value).toBe(true);

    second.resolve({ events: [], hasMore: false });
    await pendingSecond;
    expect(isLoading.value).toBe(false);
  });

  it('clears isLoading after a failed load', async () => {
    loadFeed.rejects(new Error('network'));
    const { isLoading, loadFeed: load } = useFeedEvents();

    await expect(load()).rejects.toThrow('network');

    expect(isLoading.value).toBe(false);
  });
});
