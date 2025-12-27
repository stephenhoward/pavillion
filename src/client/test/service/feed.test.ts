import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import FeedService from '@/client/service/feed';
import { AutoRepostPolicy, FollowingCalendar, FollowerCalendar } from '@/common/model/follow';

describe('FeedService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: FeedService;
  let axiosGetStub: sinon.SinonStub;
  let axiosPostStub: sinon.SinonStub;
  let axiosPutStub: sinon.SinonStub;
  let axiosDeleteStub: sinon.SinonStub;

  const testCalendarId = 'test-calendar-id';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new FeedService();

    axiosGetStub = sandbox.stub(axios, 'get');
    axiosPostStub = sandbox.stub(axios, 'post');
    axiosPutStub = sandbox.stub(axios, 'put');
    axiosDeleteStub = sandbox.stub(axios, 'delete');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getFollows', () => {
    it('should fetch follows for a calendar', async () => {
      const mockFollows = [
        {
          id: 'follow-1',
          remoteCalendarId: 'remote@example.com',
          calendarId: testCalendarId,
          repostPolicy: AutoRepostPolicy.MANUAL,
        },
        {
          id: 'follow-2',
          remoteCalendarId: 'another@example.org',
          calendarId: testCalendarId,
          repostPolicy: AutoRepostPolicy.ORIGINAL,
        },
      ];

      axiosGetStub.resolves({ data: mockFollows });

      const result = await service.getFollows(testCalendarId);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/social/follows?calendarId=${testCalendarId}`);

      // Result should be FollowingCalendar model instances
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(FollowingCalendar);
      expect(result[0].id).toBe('follow-1');
      expect(result[0].remoteCalendarId).toBe('remote@example.com');
      expect(result[0].repostPolicy).toBe(AutoRepostPolicy.MANUAL);
      expect(result[1]).toBeInstanceOf(FollowingCalendar);
      expect(result[1].id).toBe('follow-2');
      expect(result[1].repostPolicy).toBe(AutoRepostPolicy.ORIGINAL);
    });
  });

  describe('getFollowers', () => {
    it('should fetch followers for a calendar', async () => {
      const mockFollowers = [
        {
          id: 'follower-1',
          remoteCalendarId: 'follower@example.com',
          calendarId: testCalendarId,
        },
        {
          id: 'follower-2',
          remoteCalendarId: 'another-follower@example.org',
          calendarId: testCalendarId,
        },
      ];

      axiosGetStub.resolves({ data: mockFollowers });

      const result = await service.getFollowers(testCalendarId);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/social/followers?calendarId=${testCalendarId}`);

      // Result should be FollowerCalendar model instances
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(FollowerCalendar);
      expect(result[0].id).toBe('follower-1');
      expect(result[0].remoteCalendarId).toBe('follower@example.com');
      expect(result[1]).toBeInstanceOf(FollowerCalendar);
      expect(result[1].id).toBe('follower-2');
    });
  });

  describe('getFeed', () => {
    it('should fetch feed events with pagination', async () => {
      const mockResponse = {
        events: [
          {
            id: 'event-1',
            calendarId: testCalendarId,
            content: {
              en: {
                language: 'en',
                name: 'Test Event 1',
                description: 'Test description',
              },
            },
            repostStatus: 'none',
          },
          {
            id: 'event-2',
            calendarId: testCalendarId,
            content: {
              en: {
                language: 'en',
                name: 'Test Event 2',
                description: 'Test description 2',
              },
            },
            repostStatus: 'manual',
          },
        ],
        hasMore: true,
      };

      axiosGetStub.resolves({ data: mockResponse });

      const result = await service.getFeed(testCalendarId, 0, 20);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/social/feed?calendarId=${testCalendarId}&page=0&pageSize=20`);
      expect(result.events).toHaveLength(2);
      expect(result.events[0].id).toBe('event-1');
      expect(result.events[0].repostStatus).toBe('none');
      expect(result.events[1].id).toBe('event-2');
      expect(result.events[1].repostStatus).toBe('manual');
      expect(result.hasMore).toBe(true);
    });
  });

  describe('updateFollowPolicy', () => {
    it('should update follow policy', async () => {
      const followId = 'follow-1';
      const newPolicy = AutoRepostPolicy.ALL;
      const mockUpdated = {
        id: followId,
        remoteCalendarId: 'remote@example.com',
        calendarId: testCalendarId,
        repostPolicy: newPolicy,
      };

      axiosPutStub.resolves({ data: mockUpdated });

      const result = await service.updateFollowPolicy(followId, newPolicy, testCalendarId);

      expect(axiosPutStub.calledOnce).toBe(true);
      expect(axiosPutStub.firstCall.args[0]).toBe(`/api/v1/social/follows/${followId}`);
      // ModelService.updateModel sends the model's toObject() as request body
      expect(axiosPutStub.firstCall.args[1]).toEqual({
        id: followId,
        remoteCalendarId: '',
        calendarId: testCalendarId,
        repostPolicy: newPolicy,
      });

      // Result should be a FollowingCalendar model instance
      expect(result).toBeInstanceOf(FollowingCalendar);
      expect(result.id).toBe(followId);
      expect(result.remoteCalendarId).toBe('remote@example.com');
      expect(result.repostPolicy).toBe(newPolicy);
    });
  });

  describe('lookupRemoteCalendar', () => {
    it('should lookup remote calendar via backend API', async () => {
      const identifier = 'calendar@remote-instance.com';
      const mockResponse = {
        name: 'Test Calendar',
        description: 'A test calendar',
        domain: 'remote-instance.com',
        actorUrl: 'https://remote-instance.com/u/calendar',
      };

      // Mock backend API call
      axiosGetStub.resolves({ data: mockResponse });

      const result = await service.lookupRemoteCalendar(identifier);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/social/lookup?identifier=${encodeURIComponent(identifier)}`);
      expect(result.domain).toBe('remote-instance.com');
      expect(result.actorUrl).toBe('https://remote-instance.com/u/calendar');
      expect(result.name).toBe('Test Calendar');
    });
  });
});
