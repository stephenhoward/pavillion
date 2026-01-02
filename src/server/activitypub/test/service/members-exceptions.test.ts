import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('ActivityPubService Exception Handling', () => {
  let service: ActivityPubService;
  let sandbox: sinon.SinonSandbox;
  let account: Account;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
    account = Account.fromObject({ id: 'test-account-id' });
    calendar = Calendar.fromObject({ id: 'test-calendar-id', urlName: 'testcalendar' });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('followCalendar', () => {
    it('throws InvalidRemoteCalendarIdentifierError for invalid identifier', async () => {
      await expect(
        service.followCalendar(account, calendar, 'invalid-identifier'),
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
      await expect(
        service.lookupRemoteCalendar('invalid-format'),
      ).rejects.toThrow(InvalidRemoteCalendarIdentifierError);

      await expect(
        service.lookupRemoteCalendar('no-at-sign.com'),
      ).rejects.toThrow(InvalidRemoteCalendarIdentifierError);
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
  });
});
