/**
 * The peer-declared page URL, from its actor document to our cache.
 *
 * A remote peer's public page URL is not ours to construct — since DEC-018 the
 * public URL shape is version-dependent, so templating our own route shape onto
 * a peer's host only works for peers running our version. The peer declares its
 * own page in its actor document's `url`, and this is the only path that reads
 * it: the follow path already fetches the actor document, and the display path
 * reads the cache and never fetches.
 *
 * Shape normalization and the host pin are tested directly on
 * `sanitizePeerPageUrl` (test/helper/url-sanitizer.test.ts); what is covered
 * here is the wiring — that `lookupRemoteCalendar` reads `profile.url` through
 * the sanitizer at all, and that `followCalendar` persists the result.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import axios from 'axios';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubService from '@/server/activitypub/service/members';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import CalendarInterface from '@/server/calendar/interface';

vi.mock('@/server/common/helper/ip-validation', () => ({
  validateUrlNotPrivate: vi.fn().mockResolvedValue(true),
  isPrivateIP: vi.fn().mockReturnValue(false),
}));

const REMOTE_ACTOR_URL = 'https://remote.example.com/calendars/remote-cal';

describe('peer page URL population', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;
  let account: Account;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus, new CalendarInterface(eventBus));
    account = Account.fromObject({ id: 'test-account-id' });
    calendar = Calendar.fromObject({ id: 'test-calendar-id', urlName: 'testcalendar' });
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  /**
   * Stubs the WebFinger hop and the actor-document GET that
   * lookupRemoteCalendar performs, with `declaredUrl` as the document's `url`.
   */
  function stubActorDocument(declaredUrl: unknown): void {
    const axiosStub = sandbox.stub(axios, 'get');
    axiosStub.onFirstCall().resolves({
      data: {
        links: [
          { rel: 'self', type: 'application/activity+json', href: REMOTE_ACTOR_URL },
        ],
      },
    });
    axiosStub.onSecondCall().resolves({
      data: {
        type: 'Organization',
        preferredUsername: 'remote-cal',
        name: 'Remote Calendar',
        url: declaredUrl,
      },
    });
  }

  describe('lookupRemoteCalendar', () => {
    it('returns the page URL the peer declared', async () => {
      stubActorDocument('https://remote.example.com/remote-cal');

      const result = await service.lookupRemoteCalendar('remote-cal@remote.example.com');

      expect(result.pageUrl).toBe('https://remote.example.com/remote-cal');
    });

    it('reads the `url` through the sanitizer rather than verbatim', async () => {
      // Off-host: the sanitizer's host pin must apply at this call site too,
      // or a hostile peer's URL would reach the cache and then the page.
      stubActorDocument('https://phish.example/remote-cal');

      const result = await service.lookupRemoteCalendar('remote-cal@remote.example.com');

      expect(result.pageUrl).toBeNull();
    });

    it('returns null when the peer declares no url, without failing the lookup', async () => {
      stubActorDocument(undefined);

      const result = await service.lookupRemoteCalendar('remote-cal@remote.example.com');

      expect(result.pageUrl).toBeNull();
      expect(result.actorUrl).toBe(REMOTE_ACTOR_URL);
      expect(result.name).toBe('Remote Calendar');
    });
  });

  describe('followCalendar', () => {
    /**
     * Stubs everything followCalendar does after resolving the profile, so the
     * assertion can be about the metadata write alone.
     */
    function stubFollowSideEffects(): sinon.SinonStub {
      sandbox.stub(service.calendarService, 'userCanModifyCalendar').resolves(true);
      sandbox.stub(service, 'actorUrl').resolves('https://pavillion.dev/calendars/testcalendar');
      sandbox.stub(service.remoteCalendarService, 'findOrCreateByActorUri')
        .resolves({ id: 'remote-actor-uuid' } as never);
      sandbox.stub(FollowingCalendarEntity, 'findOne').resolves(null);
      sandbox.stub(FollowingCalendarEntity.prototype, 'save').resolves();
      sandbox.stub(service, 'addToOutbox').resolves();
      return sandbox.stub(service.remoteCalendarService, 'updateMetadata').resolves(null);
    }

    it('persists the declared page URL through updateMetadata', async () => {
      stubActorDocument('https://remote.example.com/remote-cal');
      const updateMetadata = stubFollowSideEffects();

      await service.followCalendar(account, calendar, 'remote-cal@remote.example.com');

      expect(updateMetadata.calledOnce).toBe(true);
      expect(updateMetadata.firstCall.args[0]).toBe(REMOTE_ACTOR_URL);
      expect(updateMetadata.firstCall.args[1]).toMatchObject({
        displayName: 'Remote Calendar',
        pageUrl: 'https://remote.example.com/remote-cal',
      });
    });

    it('writes an explicit null when the peer declared nothing usable', async () => {
      // An explicit null, not an omitted key: a peer that removes or breaks its
      // `url` must clear the cached value rather than leave a stale one behind.
      stubActorDocument({ type: 'Link', href: 'javascript:alert(1)' });
      const updateMetadata = stubFollowSideEffects();

      await service.followCalendar(account, calendar, 'remote-cal@remote.example.com');

      expect(updateMetadata.firstCall.args[1]).toMatchObject({ pageUrl: null });
    });
  });
});
