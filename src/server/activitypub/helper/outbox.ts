import { DateTime } from "luxon";
import { EventEmitter } from "events";
import { Calendar } from "@/common/model/calendar";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import { ActivityPubOutboxMessageEntity } from "@/server/activitypub/entity/activitypub";

/**
 * Shared helper for adding messages to the ActivityPub outbox.
 * This ensures that the outboxMessageAdded event is properly emitted
 * so that the outbox processor can handle delivery.
 *
 * The activity's `actor` field is preserved on the persisted message and
 * used by the outbox worker to resolve the signing key (calendar actor or
 * user actor). Callers are responsible for passing a valid local calendar
 * to anchor the message via `calendar_id` (FK).
 *
 * @param eventBus - The event emitter to notify of new outbox messages
 * @param calendar - The local calendar to anchor the outbox message under
 * @param message - The ActivityPub activity to send
 */
export async function addToOutbox(
  eventBus: EventEmitter,
  calendar: Calendar,
  message: ActivityPubActivity,
): Promise<void> {
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
