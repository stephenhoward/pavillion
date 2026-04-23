import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import axios from 'axios';

import { Account } from '@/common/model/account';
import ActivityPubService from '@/server/activitypub/service/members';
import { Calendar } from '@/common/model/calendar';
import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicySettingsError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
} from '@/common/exceptions/activitypub';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import CalendarInterface from '@/server/calendar/interface';

// Mock the ip-validation module so tests can control SSRF validation behaviour
// without performing real DNS lookups. Defaults to resolving safely (no throw).
vi.mock('@/server/common/helper/ip-validation', () => ({
  validateUrlNotPrivate: vi.fn().mockResolvedValue(true),
  isPrivateIP: vi.fn().mockReturnValue(false),
}));

import { validateUrlNotPrivate } from '@/server/common/helper/ip-validation';

describe('ActivityPubService Exception Handling', () => {
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

  describe('followCalendar', () => {
    it('throws InvalidRemoteCalendarIdentifierError for invalid identifier', async () => {
      await expect(
        service.followCalendar(account, calendar, 'has spaces'),
      ).rejects.toThrow(InvalidRemoteCalendarIdentifierError);
    });

    it('throws InsufficientCalendarPermissionsError when user cannot modify calendar', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(false);

      await expect(
        service.followCalendar(account, calendar, 'remote@example.com'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('throws SelfFollowError when calendar tries to follow itself', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(true);

      // Mock config to return matching domain
      const configStub = sandbox.stub(require('config'), 'get');
      configStub.withArgs('domain').returns('pavillion.dev');

      await expect(
        service.followCalendar(account, calendar, 'testcalendar@pavillion.dev'),
      ).rejects.toThrow(SelfFollowError);
    });

    it('throws SelfFollowError when a bare urlName resolves to the calendar itself', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(true);

      const configStub = sandbox.stub(require('config'), 'get');
      configStub.withArgs('domain').returns('pavillion.dev');

      await expect(
        service.followCalendar(account, calendar, 'testcalendar'),
      ).rejects.toThrow(SelfFollowError);
    });

    it('throws SelfFollowError for case-variant bare urlName matching the calendar', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(true);

      const configStub = sandbox.stub(require('config'), 'get');
      configStub.withArgs('domain').returns('pavillion.dev');

      // Normalization lowercases both the user's input and the calendar's
      // stored urlName before comparing, so TESTCALENDAR must still trip
      // the self-follow guard regardless of collation behaviour.
      await expect(
        service.followCalendar(account, calendar, 'TESTCALENDAR'),
      ).rejects.toThrow(SelfFollowError);
    });
  });

  describe('unfollowCalendar', () => {
    it('throws InsufficientCalendarPermissionsError when user cannot modify calendar', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(false);

      await expect(
        service.unfollowCalendar(account, calendar, 'remote@example.com'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('shareEvent', () => {
    it('throws InsufficientCalendarPermissionsError when user cannot modify calendar', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(false);

      await expect(
        service.shareEvent(account, calendar, 'https://example.com/events/123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('throws InvalidSharedEventUrlError for invalid URL', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(true);

      await expect(
        service.shareEvent(account, calendar, 'not-a-valid-url'),
      ).rejects.toThrow(InvalidSharedEventUrlError);

      await expect(
        service.shareEvent(account, calendar, 'http://insecure.com/event'),
      ).rejects.toThrow(InvalidSharedEventUrlError);
    });
  });

  describe('unshareEvent', () => {
    it('throws InsufficientCalendarPermissionsError when user cannot modify calendar', async () => {
      const userCanModifyStub = sandbox.stub(service.calendarService, 'userCanModifyCalendar');
      userCanModifyStub.returns(false);

      await expect(
        service.unshareEvent(account, calendar, 'https://example.com/events/123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('updateFollowPolicy', () => {
    it('throws InvalidRepostPolicySettingsError for invalid policy combination', async () => {
      // autoRepostReposts=true with autoRepostOriginals=false should throw
      await expect(
        service.updateFollowPolicy(calendar, 'follow-id-123', false, true),
      ).rejects.toThrow(InvalidRepostPolicySettingsError);
    });

    it('throws FollowRelationshipNotFoundError when follow relationship does not exist', async () => {
      const findOneStub = sandbox.stub(FollowingCalendarEntity, 'findOne');
      findOneStub.resolves(null);

      await expect(
        service.updateFollowPolicy(calendar, 'nonexistent-follow-id', true, false),
      ).rejects.toThrow(FollowRelationshipNotFoundError);
    });
  });

  describe('lookupRemoteCalendar', () => {
    it('throws InvalidRemoteCalendarIdentifierError for invalid identifier format', async () => {
      // Whitespace is invalid in both qualified and bare-urlName forms.
      await expect(
        service.lookupRemoteCalendar('has spaces'),
      ).rejects.toThrow(InvalidRemoteCalendarIdentifierError);

      // Dots in a bare urlName aren't allowed, and without an `@` this can't
      // be interpreted as a qualified identifier.
      await expect(
        service.lookupRemoteCalendar('no-at-sign.com'),
      ).rejects.toThrow(InvalidRemoteCalendarIdentifierError);
    });

    it('resolves a bare urlName as a local calendar lookup', async () => {
      const configStub = sandbox.stub(require('config'), 'get');
      configStub.withArgs('domain').returns('pavillion.dev');

      const localCalendar = new Calendar('local-calendar-id', 'mycal');

      const getCalendarByNameStub = sandbox.stub(service.calendarService, 'getCalendarByName');
      getCalendarByNameStub.withArgs('mycal').resolves(localCalendar);

      const result = await service.lookupRemoteCalendar('mycal');

      expect(result.domain).toBe('pavillion.dev');
      expect(result.calendarId).toBe('local-calendar-id');
      expect(result.actorUrl).toBe('https://pavillion.dev/calendars/mycal');
      expect(getCalendarByNameStub.calledWith('mycal')).toBe(true);
    });

    it('throws RemoteCalendarNotFoundError for a bare urlName with no matching local calendar', async () => {
      const configStub = sandbox.stub(require('config'), 'get');
      configStub.withArgs('domain').returns('pavillion.dev');

      const getCalendarByNameStub = sandbox.stub(service.calendarService, 'getCalendarByName');
      getCalendarByNameStub.resolves(null);

      await expect(
        service.lookupRemoteCalendar('missingcal'),
      ).rejects.toThrow(RemoteCalendarNotFoundError);
    });

    it('throws RemoteCalendarNotFoundError when local calendar does not exist', async () => {
      const configStub = sandbox.stub(require('config'), 'get');
      configStub.withArgs('domain').returns('pavillion.dev');

      const getCalendarByNameStub = sandbox.stub(service.calendarService, 'getCalendarByName');
      getCalendarByNameStub.resolves(null);

      await expect(
        service.lookupRemoteCalendar('nonexistent@pavillion.dev'),
      ).rejects.toThrow(RemoteCalendarNotFoundError);
    });

    it('throws RemoteDomainUnreachableError for connection errors', async () => {
      const axiosStub = sandbox.stub(axios, 'get');
      const error: any = new Error('Network error');
      error.code = 'ENOTFOUND';
      axiosStub.rejects(error);

      await expect(
        service.lookupRemoteCalendar('user@unreachable.com'),
      ).rejects.toThrow(RemoteDomainUnreachableError);
    });

    it('throws RemoteDomainUnreachableError for ECONNREFUSED errors', async () => {
      const axiosStub = sandbox.stub(axios, 'get');
      const error: any = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      axiosStub.rejects(error);

      await expect(
        service.lookupRemoteCalendar('user@refused.com'),
      ).rejects.toThrow(RemoteDomainUnreachableError);
    });

    it('throws RemoteCalendarNotFoundError for WebFinger 404', async () => {
      const axiosStub = sandbox.stub(axios, 'get');
      const error: any = new Error('Not found');
      error.response = { status: 404 };
      axiosStub.rejects(error);

      await expect(
        service.lookupRemoteCalendar('notfound@example.com'),
      ).rejects.toThrow(RemoteCalendarNotFoundError);
    });

    it('throws ActivityPubNotSupportedError when remote does not support ActivityPub', async () => {
      const axiosStub = sandbox.stub(axios, 'get');
      axiosStub.onFirstCall().resolves({
        data: {
          links: [
            { rel: 'profile', type: 'text/html', href: 'https://example.com/user' },
          ],
        },
      });

      await expect(
        service.lookupRemoteCalendar('user@example.com'),
      ).rejects.toThrow(ActivityPubNotSupportedError);
    });

    it('throws RemoteCalendarNotFoundError when actor profile endpoint returns 404', async () => {
      const axiosStub = sandbox.stub(axios, 'get');

      // First call succeeds (WebFinger)
      axiosStub.onFirstCall().resolves({
        data: {
          links: [
            { rel: 'self', type: 'application/activity+json', href: 'https://example.com/actor' },
          ],
        },
      });

      // Second call returns 404 (actor profile not found)
      const notFoundError: any = new Error('Not Found');
      notFoundError.response = { status: 404 };
      axiosStub.onSecondCall().rejects(notFoundError);

      await expect(
        service.lookupRemoteCalendar('user@example.com'),
      ).rejects.toThrow(RemoteCalendarNotFoundError);
    });

    it('throws RemoteProfileFetchError when actor profile fetch fails', async () => {
      const axiosStub = sandbox.stub(axios, 'get');

      // First call succeeds (WebFinger)
      axiosStub.onFirstCall().resolves({
        data: {
          links: [
            { rel: 'self', type: 'application/activity+json', href: 'https://example.com/actor' },
          ],
        },
      });

      // Second call fails (actor profile)
      axiosStub.onSecondCall().rejects(new Error('Profile fetch failed'));

      await expect(
        service.lookupRemoteCalendar('user@example.com'),
      ).rejects.toThrow(RemoteProfileFetchError);
    });

    it('throws RemoteProfileFetchError when webfingerUrl resolves to a private IP (SSRF)', async () => {
      // Simulate validateUrlNotPrivate blocking the WebFinger URL
      vi.mocked(validateUrlNotPrivate).mockRejectedValueOnce(
        new Error('Hostname private-domain.example resolves to a private IP address'),
      );

      await expect(
        service.lookupRemoteCalendar('user@private-domain.example'),
      ).rejects.toThrow(RemoteProfileFetchError);
    });

    it('throws RemoteProfileFetchError when actorUrl resolves to a private IP (SSRF)', async () => {
      const axiosStub = sandbox.stub(axios, 'get');

      // WebFinger validation passes (public domain)
      // Actor URL validation throws (private IP in actor href)
      vi.mocked(validateUrlNotPrivate)
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(
          new Error('Access to private IP address 192.168.1.1 is not allowed'),
        );

      // WebFinger responds with an actor URL pointing to a private IP
      axiosStub.onFirstCall().resolves({
        data: {
          links: [
            { rel: 'self', type: 'application/activity+json', href: 'https://192.168.1.1/actor' },
          ],
        },
      });

      await expect(
        service.lookupRemoteCalendar('user@example.com'),
      ).rejects.toThrow(RemoteProfileFetchError);
    });
  });
});

describe('ActivityPubService.normalizeIdentifier', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const configStub = sandbox.stub(require('config'), 'get');
    configStub.withArgs('domain').returns('pavillion.dev');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns the qualified identifier lowercased when valid', () => {
    expect(ActivityPubService.normalizeIdentifier('User@Example.Com')).toBe('user@example.com');
  });

  it('qualifies a bare urlName with the local domain', () => {
    expect(ActivityPubService.normalizeIdentifier('mycal')).toBe('mycal@pavillion.dev');
  });

  it('lowercases a mixed-case bare urlName before qualifying', () => {
    expect(ActivityPubService.normalizeIdentifier('MyCAL')).toBe('mycal@pavillion.dev');
  });

  it('accepts a bare urlName with a trailing underscore', () => {
    // Calendar urlNames may end in `_` per isValidCalendarUrlName; the
    // bare-urlName path must match that rule so client and server agree.
    expect(ActivityPubService.normalizeIdentifier('my_cal_')).toBe('my_cal_@pavillion.dev');
  });

  it('returns null for a qualified identifier with an invalid domain', () => {
    expect(ActivityPubService.normalizeIdentifier('user@not a domain')).toBeNull();
  });

  it('returns null for a bare string that is not a valid urlName', () => {
    expect(ActivityPubService.normalizeIdentifier('has spaces')).toBeNull();
    expect(ActivityPubService.normalizeIdentifier('_leadunderscore')).toBeNull();
    expect(ActivityPubService.normalizeIdentifier('ab')).toBeNull(); // too short
  });

  it('returns null for an identifier with more than one @', () => {
    expect(ActivityPubService.normalizeIdentifier('user@domain@extra')).toBeNull();
  });
});
