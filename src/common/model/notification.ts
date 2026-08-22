/**
 * What a notification row points at, decided by the server.
 *
 * Every `kind` names a resource **plus the viewer's authority over it**, never
 * a destination screen. `moderation_report` and `owner_report` are the same
 * report seen with different authority, which is why their payloads differ: an
 * admin reaches the moderation queue, a calendar owner reaches their own
 * calendar's reports. A hypothetical `settings_tab` kind would violate the
 * invariant — it names a screen, not a resource.
 *
 * Keeping authority in the discriminant means the client never re-derives the
 * viewer's role to decide where a row leads; the server has already decided.
 *
 * `kind` values are snake_case to match the sibling `actor.kind` discriminant
 * in `NotificationResponse` below.
 */
export type NotificationTarget =
  | { kind: 'event'; eventId: string }
  | { kind: 'calendar'; calendarUrlName: string }
  | { kind: 'moderation_report'; reportId: string }
  | { kind: 'owner_report'; reportId: string; calendarUrlName: string };

/**
 * Wire-shape returned by `GET /api/v1/notification`. The response is a
 * per-recipient projection over the (activity, recipient) pair — `id` is
 * the recipient row, `activityId` is the underlying activity, and
 * `seen`/`dismissed` are derived inline from the recipient's nullable
 * timestamps (the persistence layer does not store boolean projections).
 *
 * Identity columns on `notification_activity` (`actor_account_id`,
 * `actor_uri`) are intentionally NOT exposed; only `actor.kind`,
 * `actor.displayName`, and `actor.displayUrl` reach the client.
 *
 * For Flag rows the server forces `actor.kind === 'anonymous'` regardless
 * of the underlying actor's real type — the entity layer already stores
 * `actor_kind='anonymous'` with identity columns NULL, so the projection
 * cannot leak Flag reporter identity even by accident. Clients distinguish
 * a fully-anonymous report from an instance-attributed one by inspecting
 * `actor.displayUrl` (`null` vs `https://<host>`).
 *
 * This shape lives in `src/common/model/` because it crosses the
 * server/client boundary: the read path's natural domain model IS the wire
 * shape — there is no per-recipient domain object that diverges from what
 * the client renders. The API route handler delegates to `getNotifications`
 * and returns the result directly; the client service deserializes into
 * this same interface.
 */
export interface NotificationResponse {
  id: string;
  activityId: string;
  verb: string;
  origin: 'local' | 'federated';
  actor: {
    kind: 'account' | 'remote_actor' | 'anonymous' | 'system';
    displayName: string;
    displayUrl: string | null;
  };
  object: {
    type: string;
    id: string;
    label: string;
    /** Where this row leads for this recipient; `null` renders as plain text. */
    target: NotificationTarget | null;
  };
  seen: boolean;
  dismissed: boolean;
  createdAt: string;
}
