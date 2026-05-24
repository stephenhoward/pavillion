import { type NotificationResponse } from '@/common/model/notification';
import NotificationService, {
  type DismissForObjectInput,
  type RecordActivityInput,
} from '@/server/notifications/service/notification';

/**
 * Notifications domain interface.
 *
 * This interface is the
 * single externally-visible surface of the notifications domain. The write
 * path (`recordActivity`, `dismissForObject`) is called only by
 * `NotificationEventHandlers` (inside the notifications domain itself);
 * emitting domains route through the event bus and never obtain a reference
 * to this object directly. The read path (`getNotifications`) is exposed
 * to the API layer
 * the recipient+activity query and projection to the service rather than
 * touching entities directly, matching the convention used by every other
 * domain API in the codebase.
 */
export default class NotificationsInterface {
  private service: NotificationService;

  constructor(service: NotificationService) {
    this.service = service;
  }

  /**
   * Records a notification activity and fans it out to its audience.
   *
   * Inside the notifications domain this is the single insert path: it
   * handles per-verb dedup, Flag actor anonymization, snapshot
   * sanitization, audience resolution, and recipient fan-out in one DB
   * transaction. Callers should consult `RecordActivityInput` for field-
   * level docs.
   *
   * Returns `void`: no caller consumes activity-id, recipient-count, or
   * dedup-status today. Dedup hits are logged inside the service for ops
   * visibility; reintroduce a typed result when a real caller needs to
   * branch on the outcome.
   *
   * @param input - Activity payload (verb, actor, object, audience).
   */
  async recordActivity(input: RecordActivityInput): Promise<void> {
    return this.service.recordActivity(input);
  }

  /**
   * Dismisses open recipient rows for activities matching the supplied
   * object reference and optional filters. Two intended call shapes:
   *
   *   - Object-state transitions (no actor filter) — every recipient of
   *     every matching activity for the object is dismissed.
   *   - Actor-scoped reversals (actorAccountId OR actorUri set) — only
   *     recipients of the matching actor's activity are dismissed.
   *
   * Idempotent: the underlying UPDATE filters on
   * `WHERE dismissed_at IS NULL`, so re-running the same call is a no-op
   * against rows already dismissed.
   *
   * @throws If both `actorAccountId` and `actorUri` are set.
   */
  async dismissForObject(input: DismissForObjectInput): Promise<void> {
    return this.service.dismissForObject(input);
  }

  /**
   * Returns paginated notifications for the supplied account, ordered most
   * recent first. The query is scoped strictly to recipient rows owned by
   * `accountId`; there is no admin override. See `NotificationResponse` for
   * the wire shape — identity columns are intentionally absent and Flag
   * rows surface with `actor.kind='anonymous'` regardless of the underlying
   * reporter identity.
   *
   * @param accountId - Authenticated account id; the scope filter.
   * @param limit - Page size (the route handler clamps to [1, 100]).
   * @param offset - Pagination offset (the route handler clamps to [0, 10000]).
   */
  async getNotifications(
    accountId: string,
    limit: number,
    offset: number,
  ): Promise<NotificationResponse[]> {
    return this.service.getNotifications(accountId, limit, offset);
  }
}
