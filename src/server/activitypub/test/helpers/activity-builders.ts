/**
 * ActivityPub activity builders for Pavillion tests.
 *
 * Each builder returns a plain JSON-LD activity object with the
 * ActivityStreams context, a generated id, and the given actor and object.
 *
 * @module activity-builders
 */

/**
 * Creates a mock Follow activity for testing.
 *
 * @param actor The actor performing the follow
 * @param object The object (actor/calendar) being followed
 * @returns A Follow activity object
 */
export function createMockFollowActivity(actor: string, object: string): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Follow',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
  };
}

/**
 * Creates a mock Create activity for testing.
 *
 * @param actor The actor creating the object
 * @param object The object being created
 * @returns A Create activity object
 */
export function createMockCreateActivity(
  actor: string,
  object: Record<string, unknown>,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
    published: new Date().toISOString(),
  };
}

/**
 * Creates a mock Update activity for testing.
 *
 * @param actor The actor updating the object
 * @param object The updated object
 * @returns An Update activity object
 */
export function createMockUpdateActivity(
  actor: string,
  object: Record<string, unknown>,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Update',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
    published: new Date().toISOString(),
  };
}

/**
 * Creates a mock Delete activity for testing.
 *
 * @param actor The actor deleting the object
 * @param object The object being deleted (or its ID)
 * @returns A Delete activity object
 */
export function createMockDeleteActivity(
  actor: string,
  object: string | Record<string, unknown>,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Delete',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
    published: new Date().toISOString(),
  };
}

/**
 * Creates a mock Announce (share/boost) activity for testing.
 *
 * @param actor The actor sharing the object
 * @param object The object being shared
 * @returns An Announce activity object
 */
export function createMockAnnounceActivity(
  actor: string,
  object: string,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Announce',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
    published: new Date().toISOString(),
  };
}

/**
 * Creates a mock Undo activity for testing.
 *
 * @param actor The actor undoing the activity
 * @param object The activity being undone
 * @returns An Undo activity object
 */
export function createMockUndoActivity(
  actor: string,
  object: Record<string, unknown>,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Undo',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
    published: new Date().toISOString(),
  };
}

/**
 * Creates a mock Accept activity for testing (e.g., accepting a Follow).
 *
 * @param actor The actor accepting
 * @param object The activity being accepted
 * @returns An Accept activity object
 */
export function createMockAcceptActivity(
  actor: string,
  object: Record<string, unknown>,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Accept',
    actor,
    object,
    id: `${actor}/activities/${Date.now()}`,
    published: new Date().toISOString(),
  };
}
