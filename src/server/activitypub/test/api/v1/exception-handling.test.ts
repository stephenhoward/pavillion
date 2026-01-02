import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import ActivityPubMemberRoutes from '@/server/activitypub/api/v1/members';
import ActivityPubInterface from '@/server/activitypub/interface';
import CalendarService from '@/server/calendar/service/calendar';
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicySettingsError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
} from '@/common/exceptions/activitypub';
import { InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';

describe('ActivityPub API Exception Handling', () => {
  let routes: ActivityPubMemberRoutes;
  let sandbox: sinon.SinonSandbox;
  let activityPubInterface: ActivityPubInterface;

  const testAccount = Account.fromObject({ id: 'test-account-id', email: 'test@example.com' });
  const testCalendar = new Calendar('test-calendar-id', 'testcalendar');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    activityPubInterface = new ActivityPubInterface(eventBus);

    // Stub CalendarService prototype methods
    sandbox.stub(CalendarService.prototype, 'userCanModifyCalendar').resolves(true);

    routes = new ActivityPubMemberRoutes(activityPubInterface);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('lookupRemoteCalendar exception handling', () => {
    it('should return 400 for InvalidRemoteCalendarIdentifierError', async () => {
      sandbox.stub(activityPubInterface, 'lookupRemoteCalendar')
        .rejects(new InvalidRemoteCalendarIdentifierError('Invalid format'));

      const req = {
        user: testAccount,
        query: { identifier: 'invalid-format' },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.lookupRemoteCalendar(req as any, res as any);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('InvalidRemoteCalendarIdentifierError');
    });

    it('should return 404 for RemoteCalendarNotFoundError', async () => {
      sandbox.stub(activityPubInterface, 'lookupRemoteCalendar')
        .rejects(new RemoteCalendarNotFoundError('Calendar not found'));

      const req = {
        user: testAccount,
        query: { identifier: 'user@example.com' },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.lookupRemoteCalendar(req as any, res as any);

      expect(res.status.calledWith(404)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('RemoteCalendarNotFoundError');
    });

    it('should return 502 for RemoteDomainUnreachableError', async () => {
      sandbox.stub(activityPubInterface, 'lookupRemoteCalendar')
        .rejects(new RemoteDomainUnreachableError('Cannot connect'));

      const req = {
        user: testAccount,
        query: { identifier: 'user@unreachable.com' },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.lookupRemoteCalendar(req as any, res as any);

      expect(res.status.calledWith(502)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('RemoteDomainUnreachableError');
    });

    it('should return 502 for ActivityPubNotSupportedError', async () => {
      sandbox.stub(activityPubInterface, 'lookupRemoteCalendar')
        .rejects(new ActivityPubNotSupportedError('No ActivityPub support'));

      const req = {
        user: testAccount,
        query: { identifier: 'user@nosupport.com' },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.lookupRemoteCalendar(req as any, res as any);

      expect(res.status.calledWith(502)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('ActivityPubNotSupportedError');
    });

    it('should return 500 for RemoteProfileFetchError', async () => {
      sandbox.stub(activityPubInterface, 'lookupRemoteCalendar')
        .rejects(new RemoteProfileFetchError('Failed to fetch profile'));

      const req = {
        user: testAccount,
        query: { identifier: 'user@example.com' },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.lookupRemoteCalendar(req as any, res as any);

      expect(res.status.calledWith(500)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('RemoteProfileFetchError');
    });
  });

  describe('followCalendar exception handling', () => {
    it('should return 400 for InvalidRemoteCalendarIdentifierError', async () => {
      sandbox.stub(activityPubInterface, 'followCalendar')
        .rejects(new InvalidRemoteCalendarIdentifierError('Invalid identifier'));

      const req = {
        user: testAccount,
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          remoteCalendar: 'invalid',
        },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.followCalendar(req as any, res as any);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('InvalidRemoteCalendarIdentifierError');
    });

    it('should return 403 for InsufficientCalendarPermissionsError', async () => {
      sandbox.stub(activityPubInterface, 'followCalendar')
        .rejects(new InsufficientCalendarPermissionsError('Permission denied'));

      const req = {
        user: testAccount,
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          remoteCalendar: 'user@example.com',
        },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.followCalendar(req as any, res as any);

      expect(res.status.calledWith(403)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 400 for SelfFollowError', async () => {
      sandbox.stub(activityPubInterface, 'followCalendar')
        .rejects(new SelfFollowError('Cannot follow yourself'));

      const req = {
        user: testAccount,
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          remoteCalendar: 'self@local.com',
        },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
      };
      res.status.returns(res);

      await routes.followCalendar(req as any, res as any);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('SelfFollowError');
    });
  });

  describe('updateFollowPolicy exception handling', () => {
    it('should return 400 for InvalidRepostPolicySettingsError', async () => {
      sandbox.stub(activityPubInterface, 'updateFollowPolicy')
        .rejects(new InvalidRepostPolicySettingsError('Invalid policy settings'));

      const req = {
        user: testAccount,
        params: { id: 'follow-1' },
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          autoRepostOriginals: true,
          autoRepostReposts: true,
        },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.updateFollowPolicy(req as any, res as any);

      expect(res.status.calledWith(400)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('InvalidRepostPolicySettingsError');
    });

    it('should return 404 for FollowRelationshipNotFoundError', async () => {
      sandbox.stub(activityPubInterface, 'updateFollowPolicy')
        .rejects(new FollowRelationshipNotFoundError('Relationship not found'));
      sandbox.stub(activityPubInterface, 'getFollowing').resolves([]);

      const req = {
        user: testAccount,
        params: { id: 'nonexistent-follow' },
        body: {
          calendarId: testCalendar.id,
          calendar: testCalendar,
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
      };
      const res = {
        status: sinon.stub(),
        json: sinon.stub(),
        send: sinon.stub(),
      };
      res.status.returns(res);

      await routes.updateFollowPolicy(req as any, res as any);

      expect(res.status.calledWith(404)).toBe(true);
      expect(res.json.calledOnce).toBe(true);
      const response = res.json.firstCall.args[0];
      expect(response.error).toBeDefined();
      expect(response.errorName).toBe('FollowRelationshipNotFoundError');
    });
  });
});
