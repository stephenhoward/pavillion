import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import {
  ActivityPubEventCreatedPayload,
  ActivityPubEventUpdatedPayload,
  ActivityPubEventDeletedPayload,
} from './types';
import ActivityPubInterface from '../interface';
import CreateActivity from '../model/action/create';
import UpdateActivity from '../model/action/update';
import DeleteActivity from '../model/action/delete';
import { EventObject } from '../model/object/event';
import { ActivityPubOutboxMessageEntity, ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';

export default class ActivityPubEventHandlers implements DomainEventHandlers {
  private service: ActivityPubInterface;

  constructor(service: ActivityPubInterface) {
    this.service = service;
  }

  install(eventBus: EventEmitter): void {
    eventBus.on('eventCreated', this.handleEventCreated.bind(this));
    eventBus.on('eventUpdated', this.handleEventUpdated.bind(this));
    eventBus.on('eventDeleted', this.handleEventDeleted.bind(this));
    eventBus.on('outboxMessageAdded', this.processOutboxMessage.bind(this));
    eventBus.on('inboxMessageAdded', this.processInboxMessage.bind(this));
  }

  private async handleEventCreated(payload: ActivityPubEventCreatedPayload): Promise<void> {
    const actorUrl = await this.service.actorUrl(payload.calendar);
    await this.service.addToOutbox(
      payload.calendar,
      new CreateActivity(
        actorUrl,
        new EventObject(payload.calendar, payload.event),
      ),
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

}
