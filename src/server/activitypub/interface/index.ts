import { EventEmitter } from 'events';import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import { WebFingerResponse } from '@/server/activitypub/model/webfinger';
import { UserProfileResponse } from '@/server/activitypub/model/userprofile';
import { FollowingCalendar, FollowerCalendar } from '@/common/model/follow';
import ActivityPubMemberService from '@/server/activitypub/service/members';
import ActivityPubServerService from '@/server/activitypub/service/server';
import ProcessInboxService from '../service/inbox';
import ProcessOutboxService from '../service/outbox';
import { ActivityPubOutboxMessageEntity, ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';

/**
 * Implementation of the ActivityPub internal API interface
 * Aggregates functionality from both member and server services
 */
export default class ActivityPubInterface {
  private memberService: ActivityPubMemberService;
  private serverService: ActivityPubServerService;
  private inboxSerivce: ProcessInboxService;
  private outboxService: ProcessOutboxService;

  constructor(eventBus: EventEmitter ) {
    this.memberService = new ActivityPubMemberService(eventBus);
    this.serverService = new ActivityPubServerService(eventBus);
    this.inboxSerivce = new ProcessInboxService(eventBus);
    this.outboxService = new ProcessOutboxService(eventBus);
  }

  async actorUrl(calendar: Calendar): Promise<string> {
    return this.memberService.actorUrl(calendar);
  }

  async followCalendar(
    account: Account,
    calendar: Calendar,
    orgIdentifier: string,
    autoRepostOriginals: boolean = false,
    autoRepostReposts: boolean = false,
  ): Promise<void> {
    return this.memberService.followCalendar(account, calendar, orgIdentifier, autoRepostOriginals, autoRepostReposts);
  }

  async unfollowCalendar(account: Account, calendar: Calendar, orgIdentifier: string): Promise<void> {
    return this.memberService.unfollowCalendar(account, calendar, orgIdentifier);
  }

  async shareEvent(account: Account, calendar: Calendar, eventUrl: string): Promise<void> {
    return this.memberService.shareEvent(account, calendar, eventUrl);
  }

  async unshareEvent(account: Account, calendar: Calendar, eventUrl: string): Promise<void> {
    return this.memberService.unshareEvent(account, calendar, eventUrl);
  }

  async addToOutbox(calendar: Calendar, message: ActivityPubActivity): Promise<void> {
    return this.memberService.addToOutbox(calendar, message);
  }

  async addToInbox(calendar: Calendar, message: ActivityPubActivity): Promise<null> {
    return this.serverService.addToInbox(calendar, message);
  }

  async readOutbox(calendar: Calendar): Promise<ActivityPubActivity[]> {
    return this.serverService.readOutbox(calendar);
  }

  parseWebFingerResource(resource: string): { username: string; domain: string } {
    return this.serverService.parseWebFingerResource(resource);
  }

  async lookupWebFinger(urlName: string, domain: string): Promise<WebFingerResponse | null> {
    return this.serverService.lookupWebFinger(urlName, domain);
  }

  async lookupUserProfile(calendarName: string): Promise<UserProfileResponse | null> {
    return this.serverService.lookupUserProfile(calendarName);
  }

  async addFollower(remoteCalendarId: string, localCalendar: Calendar, followActivityId: string): Promise<void> {
    return this.serverService.addFollower(remoteCalendarId, localCalendar, followActivityId);
  }

  async removeFollower(remoteCalendarId: string, localCalendar: Calendar): Promise<void> {
    return this.serverService.removeFollower(remoteCalendarId, localCalendar);
  }

  async getFeed(calendar: Calendar, page?: number, pageSize?: number): Promise<EventEntity[]> {
    return this.memberService.getFeed(calendar, page, pageSize);
  }

  async getFollowing(calendar: Calendar): Promise<FollowingCalendar[]> {
    return this.memberService.getFollowing(calendar);
  }

  async getFollowers(calendar: Calendar): Promise<FollowerCalendar[]> {
    return this.memberService.getFollowers(calendar);
  }

  async updateFollowPolicy(
    calendar: Calendar,
    followId: string,
    autoRepostOriginals: boolean,
    autoRepostReposts: boolean,
  ): Promise<void> {
    return this.memberService.updateFollowPolicy(calendar, followId, autoRepostOriginals, autoRepostReposts);
  }

  async lookupRemoteCalendar(identifier: string): Promise<{
    name: string;
    description?: string;
    domain: string;
    actorUrl: string;
    calendarId?: string;
  }> {
    return this.memberService.lookupRemoteCalendar(identifier);
  }

  isValidDomain(domain: string): boolean {
    return ActivityPubMemberService.isValidDomain(domain);
  }

  isValidUsername(username: string): boolean {
    return ActivityPubMemberService.isValidUsername(username);
  }

  isValidOrgIdentifier(identifier: string): boolean {
    return ActivityPubMemberService.isValidOrgIdentifier(identifier);
  }

  async processOutboxMessage(message: ActivityPubOutboxMessageEntity): Promise<void> {
    await this.outboxService.processOutboxMessage(message);
  }
  async processInboxMessage(message: ActivityPubInboxMessageEntity): Promise<void> {
    await this.inboxSerivce.processInboxMessage(message);
  }
}
