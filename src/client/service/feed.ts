import axios from 'axios';
import { CalendarEvent } from '@/common/model/events';
import { FollowerCalendar } from '@/common/model/follow';
import ModelService from '@/client/service/models';
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicyError,
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
import { UnknownError } from '@/common/exceptions';

const errorMap = {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicyError,
  InvalidRepostPolicySettingsError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
  InsufficientCalendarPermissionsError,
};

/**
 * Follow relationship returned from API with new boolean fields
 */
export interface FollowRelationship {
  id: string;
  calendarActorId: string;
  calendarId: string;
  autoRepostOriginals: boolean;
  autoRepostReposts: boolean;
}

/**
 * Follower relationship returned from API
 */
export interface FollowerRelationship {
  id: string;
  calendarActorId: string;
  calendarId: string;
}

/**
 * Feed event extends CalendarEvent with repost status
 */
export type FeedEvent = CalendarEvent & {
  repostStatus: 'none' | 'manual' | 'auto';
};

/**
 * Feed response with pagination
 */
export interface FeedResponse {
  events: FeedEvent[];
  hasMore: boolean;
}

/**
 * Remote calendar preview data
 */
export interface RemoteCalendarPreview {
  name: string;
  description?: string;
  domain: string;
  actorUrl: string;
  calendarId?: string;
}

/**
 * Handle ActivityPub errors by mapping backend error names to frontend exception classes
 * @param error The error from the API call
 */
function handleActivityPubError(error: unknown): void {
  // Type guard to ensure error is the expected shape
  if (error && typeof error === 'object' && 'response' in error &&
      error.response && typeof error.response === 'object' && 'data' in error.response) {

    const responseData = error.response.data as Record<string, unknown>;
    const errorName = responseData.errorName as string;

    if (errorName && errorName in errorMap) {
      const ErrorClass = errorMap[errorName as keyof typeof errorMap];
      throw new ErrorClass();
    }
  }
}

/**
 * Client service for feed and social operations
 */
export default class FeedService {

  /**
   * Get list of calendars the user follows
   * @param calendarId The calendar ID to get follows for
   * @returns Promise<FollowRelationship[]> Array of follow relationships
   */
  async getFollows(calendarId: string): Promise<FollowRelationship[]> {
    try {
      const data = await ModelService.listModels(`/api/v1/social/follows?calendarId=${calendarId}`);
      return data.map(item => ({
        id: item.id,
        calendarActorId: item.calendarActorId,
        calendarId: item.calendarId,
        autoRepostOriginals: item.autoRepostOriginals ?? false,
        autoRepostReposts: item.autoRepostReposts ?? false,
      }));
    }
    catch (error) {
      console.error('Error fetching follows:', error);
      throw error;
    }
  }

  /**
   * Get list of calendars following the user
   * @param calendarId The calendar ID to get followers for
   * @returns Promise<FollowerRelationship[]> Array of follower relationships
   */
  async getFollowers(calendarId: string): Promise<FollowerRelationship[]> {
    try {
      const data = await ModelService.listModels(`/api/v1/social/followers?calendarId=${calendarId}`);
      return data.map(item => FollowerCalendar.fromObject(item));
    }
    catch (error) {
      console.error('Error fetching followers:', error);
      throw error;
    }
  }

  /**
   * Get feed events from followed calendars
   * @param calendarId The calendar ID to get feed for
   * @param page The page number (0-indexed)
   * @param pageSize The number of events per page
   * @returns Promise<FeedResponse> Feed events with pagination info
   */
  async getFeed(calendarId: string, page: number = 0, pageSize: number = 20): Promise<FeedResponse> {
    try {
      const data = await ModelService.getModel(
        `/api/v1/social/feed?calendarId=${calendarId}&page=${page}&pageSize=${pageSize}`,
      );

      if (!data) {
        return { events: [], hasMore: false };
      }

      // Convert API response to CalendarEvent objects with repostStatus
      const events: FeedEvent[] = data.events.map((eventData: any) => {
        const event = CalendarEvent.fromObject(eventData);
        return Object.assign(event, { repostStatus: eventData.repostStatus });
      });

      return {
        events,
        hasMore: data.hasMore,
      };
    }
    catch (error) {
      console.error('Error fetching feed:', error);
      throw error;
    }
  }

  /**
   * Follow a remote calendar
   * @param calendarId The local calendar ID
   * @param remoteIdentifier The remote calendar identifier (e.g., calendar@domain.com)
   * @param autoRepostOriginals Whether to auto-repost original events (default: false)
   * @param autoRepostReposts Whether to auto-repost shared events (default: false)
   * @returns Promise<void>
   */
  async followCalendar(
    calendarId: string,
    remoteIdentifier: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ): Promise<void> {
    try {
      await axios.post('/api/v1/social/follows', {
        calendarId,
        remoteCalendar: remoteIdentifier,
        autoRepostOriginals,
        autoRepostReposts,
      });
    }
    catch (error: unknown) {
      console.error('Error following calendar:', error);
      handleActivityPubError(error);
      throw new UnknownError();
    }
  }

  /**
   * Unfollow a remote calendar
   * @param calendarId The local calendar ID
   * @param calendarActorId The calendar actor identifier to unfollow
   * @returns Promise<void>
   */
  async unfollowCalendar(calendarId: string, calendarActorId: string): Promise<void> {
    try {
      await ModelService.delete(`/api/v1/social/follows/${encodeURIComponent(calendarActorId)}?calendarId=${calendarId}`);
    }
    catch (error: unknown) {
      console.error('Error unfollowing calendar:', error);
      handleActivityPubError(error);
      throw new UnknownError();
    }
  }

  /**
   * Manually repost an event to the calendar
   * @param calendarId The calendar ID to repost to
   * @param eventId The event ID to repost
   * @returns Promise<void>
   */
  async shareEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      // Using a simple object since SharedEvent isn't a PrimaryModel on the client
      await ModelService.createModel(
        { id: '', calendarId, eventId, toObject: () => ({ calendarId, eventId }) } as any,
        '/api/v1/social/shares',
      );
    }
    catch (error: unknown) {
      console.error('Error sharing event:', error);
      handleActivityPubError(error);
      throw new UnknownError();
    }
  }

  /**
   * Remove a reposted event from the calendar
   * @param calendarId The calendar ID to remove repost from
   * @param eventId The event ID to un-repost
   * @returns Promise<void>
   */
  async unshareEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await ModelService.delete(`/api/v1/social/shares/${encodeURIComponent(eventId)}?calendarId=${calendarId}`);
    }
    catch (error: unknown) {
      console.error('Error unsharing event:', error);
      handleActivityPubError(error);
      throw new UnknownError();
    }
  }

  /**
   * Update the repost policy for a follow relationship
   * @param followId The follow relationship ID
   * @param autoRepostOriginals Whether to auto-repost original events
   * @param autoRepostReposts Whether to auto-repost shared events
   * @param calendarId The calendar ID that owns the follow relationship
   * @returns Promise<FollowRelationship> The updated relationship
   */
  async updateFollowPolicy(
    followId: string,
    autoRepostOriginals: boolean,
    autoRepostReposts: boolean,
    calendarId: string,
  ): Promise<FollowRelationship> {
    try {
      const response = await axios.patch(`/api/v1/social/follows/${encodeURIComponent(followId)}`, {
        calendarId,
        autoRepostOriginals,
        autoRepostReposts,
      });
      return response.data;
    }
    catch (error: unknown) {
      console.error('Error updating follow policy:', error);
      handleActivityPubError(error);
      throw new UnknownError();
    }
  }

  /**
   * Lookup a remote calendar by identifier
   * @param identifier The remote calendar identifier (e.g., calendar@domain.com)
   * @returns Promise<RemoteCalendarPreview> Preview data for the remote calendar
   */
  async lookupRemoteCalendar(identifier: string): Promise<RemoteCalendarPreview> {
    try {
      const data = await ModelService.getModel(`/api/v1/social/lookup?identifier=${encodeURIComponent(identifier)}`);
      if (!data) {
        throw new RemoteCalendarNotFoundError();
      }
      return data as RemoteCalendarPreview;
    }
    catch (error: unknown) {
      console.error('Error looking up remote calendar:', error);
      handleActivityPubError(error);
      throw new UnknownError();
    }
  }
}
