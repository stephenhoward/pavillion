import { DateTime } from "luxon";
import { EventEmitter } from "events";
import { Calendar } from "@/common/model/calendar";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import { ActivityPubOutboxMessageEntity } from "@/server/activitypub/entity/activitypub";
import { ActivityPubActor } from "@/server/activitypub/model/base";

/**
 * Shared helper for adding messages to the ActivityPub outbox.
 * This ensures that the outboxMessageAdded event is properly emitted
 * so that the outbox processor can handle delivery.
 *
 * @param eventBus - The event emitter to notify of new outbox messages
 * @param calendar - The calendar sending the message
 * @param message - The ActivityPub activity to send
 */
export async function addToOutbox(
  eventBus: EventEmitter,
  calendar: Calendar,
  message: ActivityPubActivity,
): Promise<void> {
  const calendarUrl = ActivityPubActor.actorUrl(calendar);

  if (calendarUrl === message.actor) {
    const messageEntity = ActivityPubOutboxMessageEntity.build({
      id: message.id,
      type: message.type,
      calendar_id: calendar.id,
      message_time: DateTime.utc(),
      message: message,
    });
    await messageEntity.save();

    // Emit the event to trigger asynchronous processing
    eventBus.emit('outboxMessageAdded', message);
  }
}
