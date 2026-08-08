/**
 * ActivityPub Validation Schemas
 *
 * Zod schemas for validating ActivityPub activities and objects.
 * These schemas provide runtime type checking and validation for
 * incoming federation messages.
 *
 * Based on ActivityPub specification:
 * https://www.w3.org/TR/activitypub/
 * https://www.w3.org/TR/activitystreams-core/
 */

import { z } from 'zod';

/**
 * Schema for validating actor URIs.
 * Actor URIs must be valid HTTPS URLs in production.
 * HTTP URLs are allowed in development environments.
 */
export const actorUriSchema = z
  .string()
  .url('Actor URI must be a valid URL')
  .refine(
    (url) => {
      // Allow HTTP in development, require HTTPS in production
      const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
      return isDevelopment || url.startsWith('https://');
    },
    { message: 'Actor URI must use HTTPS protocol in production' },
  );

/**
 * Schema for validating ActivityPub object URIs.
 * Object URIs can be any valid URL (HTTPS or HTTP for development).
 */
export const objectUriSchema = z
  .string()
  .url('Object URI must be a valid URL');

/**
 * Schema for the @context field in ActivityPub activities.
 * Can be a single string or an array of strings/objects.
 * Per ActivityStreams 2.0, the context is required and typically includes
 * "https://www.w3.org/ns/activitystreams"
 */
export const contextSchema = z.union([
  z.string(),
  z.array(z.union([z.string(), z.record(z.string(), z.unknown())])),
]);

/**
 * Schema for the to/cc/bto/bcc recipient fields.
 * Recipients can be:
 * - A single URI string
 * - An array of URI strings
 * - Omitted (optional)
 *
 * Common recipients include:
 * - https://www.w3.org/ns/activitystreams#Public (public addressing)
 * - Actor URIs for direct addressing
 */
export const recipientSchema = z.union([
  z.string().url(),
  z.array(z.string().url()),
]).optional();

/**
 * Schema for ActivityPub object references.
 * An object can be:
 * - A URI string referencing the object
 * - An embedded object with at least a type (id is optional for new objects)
 *
 * Per ActivityPub spec, embedded objects in Create activities may not have
 * an id yet, as the id is typically assigned by the receiving server.
 */
export const objectReferenceSchema = z.union([
  z.string().url(),
  z.object({
    id: z.string().url().optional(),
    type: z.string(),
  }).passthrough(), // Allow additional properties
]);

/**
 * Schema for published/updated timestamp fields.
 * Must be a valid ISO 8601 datetime string.
 * Accepts various ISO 8601 formats including timezone offsets.
 */
export const timestampSchema = z
  .string()
  .refine(
    (val) => {
      // Accept ISO 8601 datetime with or without timezone
      // Examples: 2025-02-04T12:00:00Z, 2025-02-04T12:00:00+00:00, 2025-02-04T12:00:00.000Z
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;
      return iso8601Regex.test(val);
    },
    { message: 'Must be a valid ISO 8601 datetime string' },
  )
  .optional();

/**
 * Base schema for ActivityPub activities.
 * Contains common fields shared across all activity types.
 *
 * Per ActivityPub spec, all activities must have:
 * - @context: JSON-LD context
 * - id: Unique URI identifying the activity
 * - type: Activity type (Create, Update, Delete, etc.)
 * - actor: The entity performing the activity
 *
 * Optional common fields:
 * - to: Primary recipients
 * - cc: Carbon copy recipients
 * - bcc: Blind carbon copy recipients
 * - bto: Blind to recipients
 * - published: When the activity was published
 * - updated: When the activity was last updated
 */
export const activityBaseSchema = z.object({
  '@context': contextSchema,
  id: z.string().url('Activity id must be a valid URL'),
  type: z.string().min(1, 'Activity type is required'),
  actor: actorUriSchema,
  to: recipientSchema,
  cc: recipientSchema,
  bcc: recipientSchema,
  bto: recipientSchema,
  published: timestampSchema,
  updated: timestampSchema,
});

/**
 * Schema for ActivityPub Object base properties.
 * Used for embedded objects in activities.
 */
export const objectBaseSchema = z.object({
  id: z.string().url().optional(),
  type: z.string(),
  attributedTo: z.union([
    actorUriSchema,
    z.array(actorUriSchema),
  ]).optional(),
  published: timestampSchema,
  updated: timestampSchema,
  to: recipientSchema,
  cc: recipientSchema,
}).passthrough(); // Allow additional object-specific properties

/**
 * Activity types supported by the system.
 * Based on ActivityStreams 2.0 vocabulary.
 *
 * Descriptive only: `activityBaseSchema.type` is a plain non-empty string, and
 * admission is decided by the per-type switch in the inbox route handler. This
 * list documents what that switch is expected to cover; adding an entry here
 * admits nothing on its own.
 */
export const ACTIVITY_TYPES = [
  'Create',
  'Update',
  'Delete',
  'Follow',
  'Accept',
  'Reject',
  'Announce',
  'Undo',
  'Like',
  'Block',
  'Add',
  'Remove',
  // FEP-8a8e: peers (e.g. Mobilizon) send Join to RSVP/attend an event.
  // Pavillion does not handle attendance, so it validates and enqueues the
  // Join only to reply with an Ignore (FEP-8a8e's blessed unhandled-Join
  // response). Both must be recognized activity types.
  'Join',
  'Ignore',
  // Cross-instance moderation reports arrive as Flag. See flagActivitySchema.
  'Flag',
] as const;

/**
 * Schema for validating activity type values.
 */
export const activityTypeSchema = z.enum(ACTIVITY_TYPES);

/**
 * Type for a validated ActivityPub activity base.
 */
export type ActivityBase = z.infer<typeof activityBaseSchema>;

/**
 * Type for a validated actor URI.
 */
export type ActorUri = z.infer<typeof actorUriSchema>;

/**
 * Type for a validated object URI.
 */
export type ObjectUri = z.infer<typeof objectUriSchema>;

/**
 * Type for a validated object reference (URI or embedded object).
 */
export type ObjectReference = z.infer<typeof objectReferenceSchema>;

/**
 * Type for a validated ActivityPub object base.
 */
export type ObjectBase = z.infer<typeof objectBaseSchema>;

/**
 * Type for supported activity types.
 */
export type ActivityType = z.infer<typeof activityTypeSchema>;

/**
 * Schema for Update activities.
 *
 * Update activities modify an existing object. The object field contains
 * either a URI reference to the object or the complete updated object.
 *
 * Per ActivityPub spec:
 * - The object being updated must already exist
 * - The actor must have permission to update the object
 * - The object field contains the new state of the object
 *
 * @see https://www.w3.org/TR/activitypub/#update-activity-outbox
 */
export const updateActivitySchema = activityBaseSchema.extend({
  type: z.literal('Update'),
  object: objectReferenceSchema,
});

/**
 * Schema for Delete activities.
 *
 * Delete activities remove an existing object. The object field typically
 * contains a URI reference to the object being deleted, though it can also
 * contain an embedded object with tombstone information.
 *
 * Per ActivityPub spec:
 * - The object being deleted must exist
 * - The actor must have permission to delete the object
 * - After deletion, the object URI should return a Tombstone
 *
 * @see https://www.w3.org/TR/activitypub/#delete-activity-outbox
 */
export const deleteActivitySchema = activityBaseSchema.extend({
  type: z.literal('Delete'),
  object: objectReferenceSchema,
});

/**
 * Type for a validated Update activity.
 */
export type UpdateActivity = z.infer<typeof updateActivitySchema>;

/**
 * Type for a validated Delete activity.
 */
export type DeleteActivity = z.infer<typeof deleteActivitySchema>;

/**
 * Schema for ActivityPub Create activity.
 * A Create activity indicates that the actor has created the object.
 *
 * Per ActivityPub specification:
 * - The object field MUST be present and contains the created object
 * - The object can be an embedded object or a URI reference
 * - Create activities are commonly used to share new content (events, notes, etc.)
 *
 * @see https://www.w3.org/TR/activitypub/#create-activity-outbox
 */
export const createActivitySchema = activityBaseSchema.extend({
  type: z.literal('Create'),
  object: objectReferenceSchema,
});

/**
 * Type for a validated Create activity.
 */
export type CreateActivity = z.infer<typeof createActivitySchema>;

/**
 * Schema for ActivityPub Follow activity.
 * A Follow activity indicates that the actor is following the object.
 *
 * Per ActivityPub specification:
 * - The object field contains the actor being followed (URI string)
 * - Follow activities typically result in an Accept or Reject response
 * - The object is usually an actor/profile URI, but can be any followable object
 *
 * Example:
 * {
 *   "@context": "https://www.w3.org/ns/activitystreams",
 *   "type": "Follow",
 *   "actor": "https://example.com/users/alice",
 *   "object": "https://remote.example/calendars/events",
 *   "id": "https://example.com/activities/123"
 * }
 *
 * @see https://www.w3.org/TR/activitypub/#follow-activity-outbox
 */
export const followActivitySchema = activityBaseSchema.extend({
  type: z.literal('Follow'),
  object: actorUriSchema,
});

/**
 * Schema for ActivityPub Accept activity.
 * An Accept activity indicates acceptance of a previous activity.
 *
 * Per ActivityPub specification:
 * - The object field contains the activity being accepted
 * - Most commonly used to accept Follow activities
 * - Can contain either a URI reference or an embedded activity object
 * - Extends activityBaseSchema with all common fields
 *
 * Example with embedded Follow:
 * {
 *   "@context": "https://www.w3.org/ns/activitystreams",
 *   "type": "Accept",
 *   "actor": "https://remote.example/calendars/events",
 *   "object": {
 *     "type": "Follow",
 *     "actor": "https://example.com/users/alice",
 *     "object": "https://remote.example/calendars/events",
 *     "id": "https://example.com/activities/123"
 *   },
 *   "id": "https://remote.example/activities/456"
 * }
 *
 * @see https://www.w3.org/TR/activitypub/#accept-activity-inbox
 */
export const acceptActivitySchema = activityBaseSchema.extend({
  type: z.literal('Accept'),
  object: objectReferenceSchema,
});

/**
 * Type for a validated Follow activity.
 */
export type FollowActivity = z.infer<typeof followActivitySchema>;

/**
 * Type for a validated Accept activity.
 */
export type AcceptActivity = z.infer<typeof acceptActivitySchema>;

/**
 * Schema for ActivityPub Announce activity.
 * An Announce activity indicates that the actor is sharing/boosting/reposting
 * the object to their followers.
 *
 * Per ActivityPub specification:
 * - The object field contains the activity or object being announced
 * - Can contain either a URI reference or an embedded object
 * - Most commonly used to share/boost existing content (events, notes, etc.)
 * - The announced content is shown to the actor's followers
 *
 * Example:
 * {
 *   "@context": "https://www.w3.org/ns/activitystreams",
 *   "type": "Announce",
 *   "actor": "https://example.com/calendars/events",
 *   "object": "https://remote.example/events/event-123",
 *   "id": "https://example.com/activities/announce-456",
 *   "to": ["https://www.w3.org/ns/activitystreams#Public"],
 *   "cc": ["https://example.com/calendars/events/followers"]
 * }
 *
 * @see https://www.w3.org/TR/activitypub/#announce-activity-outbox
 * @see https://www.w3.org/TR/activitystreams-vocabulary/#dfn-announce
 */
export const announceActivitySchema = activityBaseSchema.extend({
  type: z.literal('Announce'),
  object: objectReferenceSchema,
});

/**
 * Schema for ActivityPub Undo activity.
 * An Undo activity indicates that the actor is undoing a previous activity.
 *
 * Per ActivityPub specification:
 * - The object field contains the activity being undone
 * - Can contain either a URI reference to the activity or an embedded activity object
 * - Most commonly used to undo Follow, Like, Announce, or Block activities
 * - The original activity should be considered reversed/cancelled
 *
 * Example with embedded Follow:
 * {
 *   "@context": "https://www.w3.org/ns/activitystreams",
 *   "type": "Undo",
 *   "actor": "https://example.com/users/alice",
 *   "object": {
 *     "type": "Follow",
 *     "actor": "https://example.com/users/alice",
 *     "object": "https://remote.example/calendars/events",
 *     "id": "https://example.com/activities/follow-123"
 *   },
 *   "id": "https://example.com/activities/undo-456"
 * }
 *
 * Example with URI reference:
 * {
 *   "@context": "https://www.w3.org/ns/activitystreams",
 *   "type": "Undo",
 *   "actor": "https://example.com/users/alice",
 *   "object": "https://example.com/activities/follow-123",
 *   "id": "https://example.com/activities/undo-456"
 * }
 *
 * @see https://www.w3.org/TR/activitypub/#undo-activity-outbox
 * @see https://www.w3.org/TR/activitystreams-vocabulary/#dfn-undo
 */
export const undoActivitySchema = activityBaseSchema.extend({
  type: z.literal('Undo'),
  object: objectReferenceSchema,
});

/**
 * Type for a validated Announce activity.
 */
export type AnnounceActivity = z.infer<typeof announceActivitySchema>;

/**
 * Type for a validated Undo activity.
 */
export type UndoActivity = z.infer<typeof undoActivitySchema>;

/**
 * Schema for ActivityPub Join activity.
 *
 * A Join activity indicates the actor wants to join/attend the object (an event
 * or group). Pavillion does not implement an attendance model, so it never acts
 * on a Join — it validates the inbound shape only so the activity can be
 * enqueued and answered with an Ignore per FEP-8a8e.
 *
 * The object being joined can be a URI reference or an embedded object.
 *
 * @see https://www.w3.org/TR/activitystreams-vocabulary/#dfn-join
 * @see https://w3id.org/fep/8a8e
 */
export const joinActivitySchema = activityBaseSchema.extend({
  type: z.literal('Join'),
  object: objectReferenceSchema,
});

/**
 * Type for a validated Join activity.
 */
export type JoinActivity = z.infer<typeof joinActivitySchema>;

/**
 * Maximum length accepted for the free-text fields of an inbound Flag.
 *
 * Mirrors `MAX_DESCRIPTION_LENGTH` in the moderation domain, which bounds what
 * a local reporter may submit. Without it a federated report would be bounded
 * only by the Express body-size default — orders of magnitude more text than a
 * local reporter can produce for the same report record.
 */
export const MAX_FLAG_TEXT_LENGTH = 2000;

/**
 * Maximum number of tags accepted on an inbound Flag. Pavillion emits one
 * (the category) or two (admin-flag + priority); the cap leaves headroom for
 * peer implementations without admitting an unbounded array.
 */
export const MAX_FLAG_TAGS = 10;

/**
 * Schema for an ActivityStreams Hashtag, as carried in a Flag's `tag` array.
 *
 * The inbound Flag handler reads the category from these tags by matching
 * `name` (minus the leading `#`) against `ReportCategory`.
 */
export const hashtagSchema = z.object({
  type: z.literal('Hashtag'),
  name: z.string().min(1).max(200),
}).passthrough();

/**
 * Schema for ActivityPub Flag activity.
 *
 * A Flag is a moderation report about the object it references — on this
 * instance, an event. Pavillion accepts Flags from any instance it has not
 * blocked: a report from a peer with no follow relationship is the expected
 * case, not an anomaly.
 *
 * The field set mirrors what `FlagActivityBuilder` emits, so a Flag forwarded
 * from one Pavillion instance validates on another.
 *
 * @see https://www.w3.org/TR/activitystreams-vocabulary/#dfn-flag
 */
export const flagActivitySchema = activityBaseSchema.extend({
  type: z.literal('Flag'),
  object: objectReferenceSchema,
  content: z.string().max(MAX_FLAG_TEXT_LENGTH).optional(),
  summary: z.string().max(MAX_FLAG_TEXT_LENGTH).optional(),
  tag: z.array(hashtagSchema).max(MAX_FLAG_TAGS).optional(),
  attributedTo: actorUriSchema.optional(),
});

/**
 * Type for a validated Flag activity.
 */
export type FlagActivity = z.infer<typeof flagActivitySchema>;
