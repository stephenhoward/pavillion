import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import sinon from 'sinon';
import i18next from 'i18next';
import FeedService, { FollowRelationship } from '@/client/service/feed';
import { FollowerCalendar } from '@/common/model/follow';

vi.mock('i18next', () => ({
  default: {
    resolvedLanguage: 'en',
  },
}));

describe('FeedService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: FeedService;
  let axiosGetStub: sinon.SinonStub;
  let axiosPostStub: sinon.SinonStub;
  let axiosPatchStub: sinon.SinonStub;
  let axiosDeleteStub: sinon.SinonStub;

  const testCalendarId = 'test-calendar-id';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new FeedService();

    axiosGetStub = sandbox.stub(axios, 'get');
    axiosPostStub = sandbox.stub(axios, 'post');
    axiosPatchStub = sandbox.stub(axios, 'patch');
    axiosDeleteStub = sandbox.stub(axios, 'delete');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getFollows', () => {
    it('should fetch follows for a calendar with boolean fields', async () => {
      const mockFollows = [
        {
          id: 'follow-1',
          calendarActorId: 'remote@example.com',
          calendarId: testCalendarId,
          autoRepostOriginals: false,
          autoRepostReposts: false,
        },
        {
          id: 'follow-2',
          calendarActorId: 'another@example.org',
          calendarId: testCalendarId,
          autoRepostOriginals: true,
          autoRepostReposts: true,
        },
      ];

      axiosGetStub.resolves({ data: mockFollows });

      const result = await service.getFollows(testCalendarId);

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.firstCall.args[0]).toBe(`/api/v1/social/follows?calendarId=${testCalendarId}`);

      // Result should be FollowRelationship objects with boolean fields
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('follow-1');
      expect(result[0].calendarActorId).toBe('remote@example.com');
      expect(result[0].autoRepostOriginals).toBe(false);
      expect(result[0].autoRepostReposts).toBe(false);
      expect(result[1].id).toBe('follow-2');
      expect(result[1].autoRepostOriginals).toBe(true);
      expect(result[1].autoRepostReposts).toBe(true);
    });
  });

  describe('getFollowers', () => {
    it('should fetch followers for a calendar', async () => {
      const mockFollowers = [
        {
          id: 'follower-1',
          calendarActorId: 'follower@example.com',
          calendarId: testCalendarId,
        },
        {
          id: 'follower-2',
          calendarActorId: 'another-follower@example.org',
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
      expect(result[0].calendarActorId).toBe('follower@example.com');
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
    it('should update follow policy with boolean fields', async () => {
      const followId = 'follow-1';
      const mockUpdated: FollowRelationship = {
        id: followId,
        calendarActorId: 'remote@example.com',
        calendarId: testCalendarId,
        autoRepostOriginals: true,
        autoRepostReposts: true,
      };

      axiosPatchStub.resolves({ data: mockUpdated });

      const result = await service.updateFollowPolicy(followId, true, true, testCalendarId);

      expect(axiosPatchStub.calledOnce).toBe(true);
      expect(axiosPatchStub.firstCall.args[0]).toBe(`/api/v1/social/follows/${followId}`);
      expect(axiosPatchStub.firstCall.args[1]).toEqual({
        calendarId: testCalendarId,
        autoRepostOriginals: true,
        autoRepostReposts: true,
      });

      // Result should be a FollowRelationship object
      expect(result.id).toBe(followId);
      expect(result.calendarActorId).toBe('remote@example.com');
      expect(result.autoRepostOriginals).toBe(true);
      expect(result.autoRepostReposts).toBe(true);
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

  describe('getCalendarCategories', () => {
    it('should return category name in the resolved language (English)', async () => {
      (i18next as any).resolvedLanguage = 'en';
      axiosGetStub.resolves({
        data: [{ id: 'cat-1', content: { en: { language: 'en', name: 'Music' }, es: { language: 'es', name: 'Música' } } }],
      });

      const result = await service.getCalendarCategories(testCalendarId);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('cat-1');
      expect(result[0].name).toBe('Music');
    });

    it('should return category name in Spanish when UI language is Spanish', async () => {
      (i18next as any).resolvedLanguage = 'es';
      axiosGetStub.resolves({
        data: [{ id: 'cat-2', content: { en: { language: 'en', name: 'Sports' }, es: { language: 'es', name: 'Deportes' } } }],
      });

      const result = await service.getCalendarCategories(testCalendarId);

      expect(result[0].name).toBe('Deportes');
    });

    it('should fall back to English when resolved language has no content', async () => {
      (i18next as any).resolvedLanguage = 'fr';
      axiosGetStub.resolves({
        data: [{ id: 'cat-3', content: { en: { language: 'en', name: 'Culture' }, es: { language: 'es', name: 'Cultura' } } }],
      });

      const result = await service.getCalendarCategories(testCalendarId);

      expect(result[0].name).toBe('Culture');
    });

    it('should fall back to first available entry when English content is also missing', async () => {
      (i18next as any).resolvedLanguage = 'fr';
      axiosGetStub.resolves({
        data: [{ id: 'cat-4', content: { de: { language: 'de', name: 'Unterhaltung' } } }],
      });

      const result = await service.getCalendarCategories(testCalendarId);

      expect(result[0].name).toBe('Unterhaltung');
    });

    it('should return empty name when content is null', async () => {
      axiosGetStub.resolves({
        data: [{ id: 'cat-5', content: null }],
      });

      const result = await service.getCalendarCategories(testCalendarId);

      expect(result[0].name).toBe('');
    });
  });
});
