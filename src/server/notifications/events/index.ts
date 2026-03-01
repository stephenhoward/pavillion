import { EventEmitter } from 'events';

import { DomainEventHandlers } from '@/server/common/types/domain';
import NotificationService from '@/server/notifications/service/notification';
import CalendarInterface from '@/server/calendar/interface';

export interface CalendarFollowedPayload {
  calendarId: string;
  followerName: string;
  followerUrl: string | null;
}

export interface EventRepostedPayload {
  eventId: string;
  calendarId: string;
  reposterName: string;
  reposterUrl: string | null;
}

export default class NotificationEventHandlers implements DomainEventHandlers {
  private service: NotificationService;
  private calendarInterface: CalendarInterface;

  constructor(service: NotificationService, calendarInterface: CalendarInterface) {
    this.service = service;
    this.calendarInterface = calendarInterface;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('activitypub:calendar:followed', this.handleCalendarFollowed.bind(this));
    eventBus.on('activitypub:event:reposted', this.handleEventReposted.bind(this));
  }

  private async handleCalendarFollowed(payload: CalendarFollowedPayload): Promise<void> {
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(payload.calendarId);
      for (const account of accounts) {
        await this.service.createNotification(
          'follow',
          payload.calendarId,
          null,
          payload.followerName,
          payload.followerUrl,
          account.id,
        );
      }
    }
    catch (error) {
      console.error('[Notifications] Error handling activitypub:calendar:followed:', error);
    }
  }

  private async handleEventReposted(payload: EventRepostedPayload): Promise<void> {
    try {
      const accounts = await this.calendarInterface.getEditorsForCalendar(payload.calendarId);
      for (const account of accounts) {
        await this.service.createNotification(
          'repost',
          payload.calendarId,
          payload.eventId,
          payload.reposterName,
          payload.reposterUrl,
          account.id,
        );
      }
    }
    catch (error) {
      console.error('[Notifications] Error handling activitypub:event:reposted:', error);
    }
  }
}
