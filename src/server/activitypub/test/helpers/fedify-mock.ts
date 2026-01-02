/**
 * Fedify Mock Utilities for Pavillion ActivityPub Testing
 *
 * This module provides testing utilities built on top of Fedify's in-memory
 * infrastructure. Rather than providing a "MockFederation" class (which Fedify
 * does not have), these utilities wrap Fedify's testing-friendly components:
 *
 * - InProcessMessageQueue: For in-memory activity message queuing
 * - MemoryKvStore: For in-memory key-value storage
 * - Activity types: For building and validating ActivityPub messages
 *
 * Key capabilities:
 * - Create in-memory federation contexts for testing
 * - Track activities that would be sent to remote servers
 * - Simulate receiving activities in an inbox
 * - Validate ActivityPub message format using Fedify's type system
 *
 * Usage pattern:
 * 1. Create a mock federation context with createMockFederation()
 * 2. Use getSentActivities() to inspect what activities were queued
 * 3. Use simulateInboxReceive() to test inbox processing
 *
 * @module fedify-mock
 */

import {
  type Activity,
  type Actor,
  Follow,
  Create,
  Update,
  Delete,
  Announce,
  Undo,
  Accept,
  Note,
  type Object as ActivityPubObject,
  InProcessMessageQueue,
  MemoryKvStore,
  type MessageQueue,
  type KvStore,
} from '@fedify/fedify';

/**
 * Represents a tracked activity that was queued for sending.
 * Used to inspect what activities would be sent to remote servers.
 */
export interface TrackedActivity {
  /** The activity object that was sent */
  activity: unknown;
  /** The recipient inbox URL(s) */
  recipients: string[];
  /** When the activity was queued */
  timestamp: Date;
  /** The activity type (e.g., 'Create', 'Follow', etc.) */
  type: string;
}

/**
 * Configuration for creating a mock federation context.
 */
export interface MockFederationConfig {
  /** The domain for this mock federation instance */
  domain?: string;
  /** Optional existing KV store to use */
  kvStore?: KvStore;
  /** Optional existing message queue to use */
  messageQueue?: MessageQueue;
}

/**
 * A mock federation context for testing ActivityPub operations.
 * Provides in-memory storage and activity tracking without network calls.
 */
export interface MockFederationContext {
  /** The domain for this mock federation instance */
  domain: string;
  /** In-memory key-value store */
  kvStore: KvStore;
  /** In-memory message queue for activities */
  messageQueue: MessageQueue;
  /** List of activities that have been queued for sending */
  sentActivities: TrackedActivity[];
  /** List of activities that have been received in the inbox */
  receivedActivities: TrackedActivity[];
  /**
   * Queue an activity to be "sent" (tracked in memory)
   * @param activity The activity to send
   * @param recipients The recipient inbox URLs
   */
  sendActivity: (activity: unknown, recipients: string[]) => Promise<void>;
  /**
   * Simulate receiving an activity in the inbox
   * @param activity The activity received
   * @param sender The sender's actor ID
   */
  receiveActivity: (activity: unknown, sender: string) => Promise<void>;
  /**
   * Clear all tracked activities (both sent and received)
   */
  reset: () => void;
}

/**
 * Creates a mock federation context for testing ActivityPub operations.
 *
 * This provides an in-memory environment that:
 * - Tracks all activities that would be sent to remote servers
 * - Allows simulating inbox receives without network calls
 * - Uses Fedify's InProcessMessageQueue and MemoryKvStore
 *
 * @param config Optional configuration for the mock context
 * @returns A MockFederationContext instance
 *
 * @example
 * ```typescript
 * const mockFed = createMockFederation({ domain: 'test.local' });
 *
 * // Queue an activity for sending
 * await mockFed.sendActivity(followActivity, ['https://remote.example/inbox']);
 *
 * // Check what was sent
 * const sent = getSentActivities(mockFed);
 * expect(sent).toHaveLength(1);
 * expect(sent[0].type).toBe('Follow');
 * ```
 */
export function createMockFederation(
  config: MockFederationConfig = {},
): MockFederationContext {
  const domain = config.domain ?? 'test.federation.local';
  const kvStore = config.kvStore ?? new MemoryKvStore();
  const messageQueue = config.messageQueue ?? new InProcessMessageQueue();

  const sentActivities: TrackedActivity[] = [];
  const receivedActivities: TrackedActivity[] = [];

  const sendActivity = async (activity: unknown, recipients: string[]): Promise<void> => {
    const activityType = extractActivityType(activity);
    sentActivities.push({
      activity,
      recipients,
      timestamp: new Date(),
      type: activityType,
    });

    // Also enqueue in the message queue for completeness
    await messageQueue.enqueue({
      type: 'outbox',
      activity,
      recipients,
      timestamp: new Date().toISOString(),
    });
  };

  const receiveActivity = async (activity: unknown, sender: string): Promise<void> => {
    const activityType = extractActivityType(activity);
    receivedActivities.push({
      activity,
      recipients: [sender],
      timestamp: new Date(),
      type: activityType,
    });

    // Also enqueue in the message queue for completeness
    await messageQueue.enqueue({
      type: 'inbox',
      activity,
      sender,
      timestamp: new Date().toISOString(),
    });
  };

  const reset = (): void => {
    sentActivities.length = 0;
    receivedActivities.length = 0;
  };

  return {
    domain,
    kvStore,
    messageQueue,
    sentActivities,
    receivedActivities,
    sendActivity,
    receiveActivity,
    reset,
  };
}

/**
 * Extracts the activity type from an activity object.
 *
 * @param activity The activity object (can be various formats)
 * @returns The activity type string (e.g., 'Create', 'Follow', etc.)
 */
function extractActivityType(activity: unknown): string {
  if (!activity || typeof activity !== 'object') {
    return 'Unknown';
  }

  const activityObj = activity as Record<string, unknown>;

  // Check for 'type' property (common in JSON-LD)
  if (typeof activityObj.type === 'string') {
    return activityObj.type;
  }

  // Check for '@type' property (JSON-LD with explicit context)
  if (typeof activityObj['@type'] === 'string') {
    return activityObj['@type'];
  }

  // Check for array type (JSON-LD can have arrays)
  if (Array.isArray(activityObj.type) && activityObj.type.length > 0) {
    return String(activityObj.type[0]);
  }

  return 'Unknown';
}

/**
 * Gets all activities that were sent through the mock federation.
 *
 * @param context The mock federation context
 * @returns Array of tracked sent activities
 *
 * @example
 * ```typescript
 * const mockFed = createMockFederation();
 * await mockFed.sendActivity(createActivity, ['https://remote/inbox']);
 *
 * const sent = getSentActivities(mockFed);
 * expect(sent[0].type).toBe('Create');
 * ```
 */
export function getSentActivities(context: MockFederationContext): TrackedActivity[] {
  return [...context.sentActivities];
}

/**
 * Gets all activities that were received through the mock federation.
 *
 * @param context The mock federation context
 * @returns Array of tracked received activities
 */
export function getReceivedActivities(context: MockFederationContext): TrackedActivity[] {
  return [...context.receivedActivities];
}

/**
 * Simulates receiving an activity in the inbox.
 *
 * This is a convenience function that wraps context.receiveActivity()
 * and provides additional type safety and validation.
 *
 * @param context The mock federation context
 * @param activity The activity to receive
 * @param sender The sender's actor ID or inbox URL
 *
 * @example
 * ```typescript
 * const mockFed = createMockFederation();
 *
 * await simulateInboxReceive(mockFed, {
 *   '@context': 'https://www.w3.org/ns/activitystreams',
 *   type: 'Follow',
 *   actor: 'https://remote.example/users/alice',
 *   object: 'https://local.example/calendars/events'
 * }, 'https://remote.example/users/alice');
 *
 * const received = getReceivedActivities(mockFed);
 * expect(received).toHaveLength(1);
 * ```
 */
export async function simulateInboxReceive(
  context: MockFederationContext,
  activity: unknown,
  sender: string,
): Promise<void> {
  // Validate activity has required properties
  if (!activity || typeof activity !== 'object') {
    throw new Error('Activity must be an object');
  }

  // Validate type is present
  const activityType = extractActivityType(activity);
  if (activityType === 'Unknown') {
    throw new Error('Activity must have a type property');
  }

  await context.receiveActivity(activity, sender);
}

/**
 * Clears all tracked activities from the mock federation context.
 *
 * @param context The mock federation context
 */
export function clearActivities(context: MockFederationContext): void {
  context.reset();
}

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

// Re-export Fedify types that are useful for testing
export {
  InProcessMessageQueue,
  MemoryKvStore,
  Follow,
  Create,
  Update,
  Delete,
  Announce,
  Undo,
  Accept,
  Note,
};

// Re-export types
export type {
  Activity,
  Actor,
  MessageQueue,
  KvStore,
  ActivityPubObject,
};
