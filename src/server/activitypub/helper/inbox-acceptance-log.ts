/**
 * Centralized logging utility for accepted inbound ActivityPub activities.
 *
 * The counterpart to `rejection-logger.ts`: where that module records why an
 * activity was refused, this one records that an activity got past every gate.
 *
 * The inbox handlers also log an arrival line ('Received inbox activity') as
 * soon as the recipient resolves. That line is emitted BEFORE actor and
 * activity validation, so it fires for activities the handler then rejects
 * with 400 and cannot be read as evidence of acceptance. This record is
 * emitted only after validation AND the inbox write (or, for the synchronous
 * paths, the processing itself) have succeeded, so its presence means the
 * activity was admitted.
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
