/**
 * Shared notification domain type aliases.
 *
 * These mirror the DB-level ENUMs declared on NotificationActivityEntity.
 * Adding a value to any of these unions requires a matching schema migration
 * on the entity ENUM (see src/server/notifications/entity/notification_activity.ts).
 *
 * Kept as a dedicated types file rather than living on the entity so service
 * code can import the union types without pulling in the Sequelize entity
 * graph.
 */

export type NotificationVerb =
  | 'Follow'
  | 'Announce'
  | 'Flag'
  | 'ReportEscalated'
  | 'ReportResolved'
  | 'EditorInvited'
  | 'EditorRevoked';

export type NotificationOrigin = 'local' | 'federated';

export type NotificationActorKind =
  | 'account'
  | 'remote_actor'
  | 'anonymous'
  | 'system';

export type NotificationObjectType = 'calendar' | 'event' | 'report';
