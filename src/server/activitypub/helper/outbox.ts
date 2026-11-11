import { DateTime } from "luxon";
import { EventEmitter } from "events";
import { Op, WhereOptions, literal } from "sequelize";
import { Calendar } from "@/common/model/calendar";
import { ActivityPubActivity, ActivityPubActor, AS_PUBLIC } from "@/server/activitypub/model/base";
import { ActivityPubOutboxMessageEntity } from "@/server/activitypub/entity/activitypub";

/** Width of the ap_outbox `processed_status` column (VARCHAR(255)). */
export const PROCESSED_STATUS_MAX_LENGTH = 255;

/**
 * Makes a delivery outcome safe to store in `processed_status`.
 *
 * The status carries error text, some of it supplied by peers, so it can hold
 * bytes PostgreSQL refuses (NUL) and run past the column width. Either makes
 * the final write throw after delivery has already happened. Control
 * characters (C0: NUL, CR, LF and the rest) become spaces, then everything
 * past the column width is dropped; later failures in a long list may be cut.
 * Cutting at 255 UTF-16 units never exceeds PostgreSQL's character count.
 *
 * @param status - The raw status text
 * @returns The status with control characters replaced, at most 255 characters
 */
export function boundProcessedStatus(status: string): string {
  // eslint-disable-next-line no-control-regex
  return status.replace(/[\u0000-\u001f]/g, ' ').slice(0, PROCESSED_STATUS_MAX_LENGTH);
}

/**
 * Whether an outbox row belongs in the calendar's public outbox (DEC-024).
 *
 * True when the activity's actor is the anchoring calendar's own actor and its
 * `to` or `cc` names as:Public or that actor's followers collection. A row
 * with no addressing is not public. The answer is stored on the row as
 * `is_public` at insert and never recomputed, so changing this rule means a
 * backfill migration as well; migration 0050 holds the frozen copy that
 * decided the rows written before the column existed.
 *
 * The actor test compares against the calendar's current actor URL, which is
 * derived from its url name. A feature that renames a calendar (`setUrlName`,
 * DEC-018 rule 4) must revisit this rule: rows already stored keep the old
 * actor URL and the value computed for it.
 *
 * @param calendar - The local calendar the row is anchored on
 * @param message - The serialized activity, as stored in `ap_outbox.message`
 */
export function isPublicOutboxActivity(calendar: Calendar, message: Record<string, unknown>): boolean {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const actor = message.actor;
  if (typeof actor !== 'string' || actor !== ActivityPubActor.actorUrl(calendar)) {
    return false;
  }
  const addressed = [...addressList(message.to), ...addressList(message.cc)];
  return addressed.includes(AS_PUBLIC) || addressed.includes(`${actor}/followers`);
}

/**
 * The activity types a calendar's public outbox serves (DEC-024).
 *
 * 'Create' MUST be served: local originals federate as Create(Event)
 * (Announce is reserved for reposts), so a follower's backfill walk of the
 * outbox — and FEP-8a8e event consumers (Mobilizon/Gancio) — only see
 * originals if Create is in the collection. Inbound Create(Note) is
 * short-circuited by the receiver (ProcessInboxService.processCreateEvent),
 * so serving the paired Note cannot create a duplicate feed event.
 */
export const SERVED_OUTBOX_TYPES = ['Create', 'Announce', 'Update', 'Delete'];

/** Rows per page of a calendar's public outbox collection. */
export const OUTBOX_PAGE_SIZE = 20;

/**
 * The `ap_outbox` rows a calendar's public outbox serves (DEC-024): rows
 * marked `is_public`, of a {@link SERVED_OUTBOX_TYPES} type, that have been
 * processed and whose processing did not fail — whatever their delivery
 * outcome, so a `partial:` row is served — minus any Announce the calendar
 * has since undone.
 *
 * `readOutbox` pages this set to peers; a same-instance follow replays it to
 * the new follower, so a local follower is caught up on exactly what a remote
 * follower's backfill walk would read.
 *
 * @param calendarId - The calendar whose outbox rows to select
 * @returns A Sequelize `where` for ActivityPubOutboxMessageEntity
 */
export function servedOutboxWhere(calendarId: string): WhereOptions {
  return {
    calendar_id: calendarId,
    type: SERVED_OUTBOX_TYPES,
    is_public: true,
    processed_time: { [Op.ne]: null },
    [Op.and]: [
      // A partial: delivery outcome does not affect membership; a failure
      // to process the row at all does, and so does a row the drain
      // skipped because it was retracted before the drain delivered it.
      { processed_status: { [Op.notLike]: 'error:%' } },
      { processed_status: { [Op.notLike]: 'skipped:%' } },
      { processed_status: { [Op.ne]: 'bad message type' } },
      // Any recorded Undo withdraws its target, whatever its delivery status.
      // Every outbox row is our own activity, and UndoActivity always takes
      // the id `{targetId}/undo`, so the matching Undo is a primary-key probe
      // per candidate row: the cost follows the page, not the calendar's
      // Undo history.
      literal(`NOT EXISTS (SELECT 1 FROM ap_outbox undo_row WHERE undo_row.id = "ActivityPubOutboxMessageEntity"."id" || '/undo' AND undo_row.type = 'Undo')`),
    ],
  };
}

/** A stored `to` or `cc`, which may be one IRI or a list, as a list of IRIs. */
function addressList(value: unknown): string[] {
  if (typeof value === 'string') {
    return value === '' ? [] : [value];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

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
  const serialized = message.toObject();
  const messageEntity = ActivityPubOutboxMessageEntity.build({
    id: message.id,
    type: message.type,
    calendar_id: calendar.id,
    message_time: DateTime.utc(),
    message: serialized,
    is_public: isPublicOutboxActivity(calendar, serialized),
  });
  await messageEntity.save();

  // Emit the event to trigger asynchronous processing
  eventBus.emit('outboxMessageAdded', message);
}
