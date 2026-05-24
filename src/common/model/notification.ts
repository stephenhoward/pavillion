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
  };
  seen: boolean;
  dismissed: boolean;
  createdAt: string;
}
