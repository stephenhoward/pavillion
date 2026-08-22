/**
 * Centralized logging utilities for inbound ActivityPub activities: the
 * arrival record every inbox writes as soon as its recipient resolves, and the
 * acceptance record written once the activity has cleared every gate.
 *
 * The acceptance record is the counterpart to `rejection-logger.ts`: where that
 * module records why an activity was refused, this one records that an activity
 * got past every gate.
 *
 * The arrival line ('Received inbox activity') is emitted BEFORE actor and
 * activity validation, so it fires for activities the handler then rejects
 * with 400 and cannot be read as evidence of acceptance. The acceptance record
 * is emitted only after validation AND the inbox write (or, for the synchronous
 * paths, the processing itself) have succeeded, so its presence means the
 * activity was admitted.
 *
 * Both inbox routes — the calendar inbox and the user inbox — call the same
 * helpers, so the redaction rule that arrival logging enforces for `Flag`
 * cannot drift between them.
 */

import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/** Which inbox admitted the activity: a calendar actor's, or a user actor's. */
export type InboxKind = 'calendar' | 'user';

/**
 * Resolve the identifier of an activity's object for logging.
 *
 * AS2 allows `object` to be either an IRI string or an embedded object
 * carrying its own `id` (Tombstone, Note, Event), so both shapes are handled.
 *
 * @param body - The raw inbound activity
 * @returns The object IRI, or undefined when the activity carries no
 *   identifiable object
 */
function activityObjectId(body: Record<string, any>): string | undefined {
  const object = body?.object;

  if (typeof object === 'string') {
    return object;
  }
  if (object && typeof object === 'object' && typeof object.id === 'string') {
    return object.id;
  }

  return undefined;
}

/**
 * Log that an inbound activity arrived at an inbox.
 *
 * Arrival, NOT acceptance: an unhandled activity type, a validation failure, or
 * a handler that refuses the activity still produces these lines. Acceptance is
 * recorded separately by `logInboxActivityAccepted`.
 *
 * Call as soon as the inbox owner resolves, on every inbox route — the `Flag`
 * redaction below is the whole reason this lives in one place.
 *
 * @param inbox - Which inbox the activity arrived at
 * @param recipient - The inbox owner's url name (calendar) or username (user)
 * @param body - The raw inbound activity
 */
export function logInboxActivityArrival(
  inbox: InboxKind,
  recipient: string,
  body: Record<string, any>,
): void {
  logger.info({ inbox, recipient, activityType: body?.type }, 'Received inbox activity');

  if (body?.type === 'Flag') {
    // A Flag carries a remote reporter's actor URI and the free text of a
    // moderation report. Everything downstream reduces that reporter to a
    // bare instance host before anything durable is written; dumping the
    // raw body here would put both the identity and the report text into
    // the logs and bypass that reduction entirely. Log only the envelope.
    logger.info({ inbox, recipient, activityId: body?.id }, 'Inbox Flag activity received (body withheld)');
    return;
  }

  logger.info({ inbox, recipient, activityBody: body }, 'Inbox activity body');
}

/**
 * Log that an inbound activity was accepted by an inbox.
 *
 * Call only once the activity has been validated and persisted/processed —
 * never on a path that can still reject.
 *
 * @param inbox - Which inbox admitted the activity
 * @param recipient - The inbox owner's url name (calendar) or username (user)
 * @param body - The raw inbound activity
 */
export function logInboxActivityAccepted(
  inbox: InboxKind,
  recipient: string,
  body: Record<string, any>,
): void {
  logger.info({
    inbox,
    recipient,
    activityType: body?.type,
    activityId: body?.id,
    objectId: activityObjectId(body),
  }, 'Inbox activity accepted');
}
