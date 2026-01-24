import { EventEmitter } from 'events';
import config from 'config';

import { DomainEventHandlers } from '@/server/common/types/domain';
import {
  ActivityPubEventCreatedPayload,
  ActivityPubEventUpdatedPayload,
  ActivityPubEventDeletedPayload,
  AccountCreatedPayload,
  CalendarCreatedPayload,
} from './types';
import ActivityPubInterface from '../interface';
import CreateActivity from '../model/action/create';
import UpdateActivity from '../model/action/update';
import DeleteActivity from '../model/action/delete';
import AnnounceActivity from '../model/action/announce';
import { EventObject } from '../model/object/event';
import { ActivityPubOutboxMessageEntity, ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import UserActorService from '../service/user_actor';
import CalendarActorService from '../service/calendar_actor';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';

export default class ActivityPubEventHandlers implements DomainEventHandlers {
  private service: ActivityPubInterface;
  private userActorService: UserActorService;
  private calendarActorService: CalendarActorService;

  constructor(service: ActivityPubInterface) {
    this.service = service;
    this.userActorService = new UserActorService();
    this.calendarActorService = new CalendarActorService();
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('eventCreated', this.handleEventCreated.bind(this));
    eventBus.on('eventUpdated', this.handleEventUpdated.bind(this));
    eventBus.on('eventDeleted', this.handleEventDeleted.bind(this));
    eventBus.on('outboxMessageAdded', this.processOutboxMessage.bind(this));
    eventBus.on('inboxMessageAdded', this.processInboxMessage.bind(this));
    eventBus.on('account.created', this.handleAccountCreated.bind(this));
    eventBus.on('calendar.created', this.handleCalendarCreated.bind(this));
  }

  private async handleEventCreated(payload: ActivityPubEventCreatedPayload): Promise<void> {
    const actorUrl = await this.service.actorUrl(payload.calendar);
    const eventUrl = EventObject.eventUrl(payload.calendar, payload.event);
    await this.service.addToOutbox(
      payload.calendar,
      new AnnounceActivity(actorUrl, eventUrl),
    );
  }

  private async handleEventUpdated(payload: ActivityPubEventUpdatedPayload): Promise<void> {
    const actorUrl = await this.service.actorUrl(payload.calendar);
    await this.service.addToOutbox(
      payload.calendar,
      new UpdateActivity(
        actorUrl,
        new EventObject(payload.calendar, payload.event),
      ),
    );
  }

  private async handleEventDeleted(payload: ActivityPubEventDeletedPayload): Promise<void> {
    const actorUrl = await this.service.actorUrl(payload.calendar);
    await this.service.addToOutbox(
      payload.calendar,
      new DeleteActivity(
        actorUrl,
        EventObject.eventUrl(payload.calendar, payload.event),
      ),
    );
  }

  private async processOutboxMessage(e) {
    let message = await ActivityPubOutboxMessageEntity.findByPk(e.id);
    if ( message ) {
      try {
        await this.service.processOutboxMessage(message);
      }
      catch (error) {
        console.error(`[OUTBOX] Error processing outbox message ${message.id}:`, error.message);
        // Mark message as processed with error status to prevent retry loop
        await message.update({
          processed_time: new Date(),
          processed_status: `error: ${error.message}`,
        });
      }
    }
    else {
      console.error("outbox message not found for processing");
    }
  }

  private async processInboxMessage(e) {
    let message = await ActivityPubInboxMessageEntity.findByPk(e.id);

    if ( ! message ) {
      console.error("inbox message not found for processing");
      return;
    }
    if ( ! message.processed_time ) {
      await this.service.processInboxMessage(message);
    }
  }

  private async handleAccountCreated(payload: AccountCreatedPayload): Promise<void> {
    try {
      // Only create UserActor if username is set
      if (!payload.username) {
        console.log(`[ActivityPub] Skipping UserActor creation for account ${payload.accountId}: no username set`);
        return;
      }

      const domain = payload.domain || config.get<string>('domain');
      if (!domain) {
        console.error(`[ActivityPub] Cannot create UserActor for account ${payload.accountId}: domain not configured`);
        return;
      }

      // Create a minimal Account object for the service
      const account = new Account(payload.accountId, payload.username, '');

      await this.userActorService.createActor(account, domain);
      console.log(`[ActivityPub] Created UserActor for account ${payload.username} (${payload.accountId})`);
    }
    catch (error) {
      // Log error but don't throw - UserActor creation failure should not break account creation
      console.error(`[ActivityPub] Failed to create UserActor for account ${payload.accountId}:`, error);
    }
  }

  private async handleCalendarCreated(payload: CalendarCreatedPayload): Promise<void> {
    try {
      // Only create CalendarActor if urlName is set
      if (!payload.urlName) {
        console.log(`[ActivityPub] Skipping CalendarActor creation for calendar ${payload.calendarId}: no urlName set`);
        return;
      }

      const domain = payload.domain || config.get<string>('domain');
      if (!domain) {
        console.error(`[ActivityPub] Cannot create CalendarActor for calendar ${payload.calendarId}: domain not configured`);
        return;
      }

      // Create a minimal Calendar object for the service
      const calendar = new Calendar(payload.calendarId, payload.urlName);

      await this.calendarActorService.createActor(calendar, domain);
      console.log(`[ActivityPub] Created CalendarActor for calendar ${payload.urlName} (${payload.calendarId})`);
    }
    catch (error) {
      // Log error but don't throw - CalendarActor creation failure should not break calendar creation
      console.error(`[ActivityPub] Failed to create CalendarActor for calendar ${payload.calendarId}:`, error);
    }
  }

}
