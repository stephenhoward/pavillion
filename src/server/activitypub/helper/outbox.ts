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
  // Persist the SERIALIZED wire form (`toObject()`), not the live activity
  // instance. An embedded ActivityPubObject (EventObject / NoteObject) only
  // renders its full AP/FEP-8a8e representation — startTime, endTime,
  // pavillion:schedules, etc. — through its `toActivityPubObject()` serializer,
  // which `ActivityPubActivity.toObject()` invokes while the object is still a
  // live instance. Storing the raw instance lets Sequelize JSON-serialize only
  // its incidental enumerable fields (`_event`, `_calendar`, ...), dropping the
  // schedule terms; both the local in-process dispatch and remote HTTP delivery
  // then rebuild the activity from that lossy row via `fromObject()`, so the
  // FEP serializer never runs and followers reconstruct an event with no
  // schedules (and therefore no event_instance rows). Serializing here is the
  // single point that guarantees the stored, locally-dispatched, and
  // HTTP-delivered forms are byte-identical.
  const messageEntity = ActivityPubOutboxMessageEntity.build({
    id: message.id,
    type: message.type,
    calendar_id: calendar.id,
    message_time: DateTime.utc(),
    message: message.toObject(),
  });
  await messageEntity.save();

  // Emit the event to trigger asynchronous processing
  eventBus.emit('outboxMessageAdded', message);
}
