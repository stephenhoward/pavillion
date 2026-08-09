import type { NotificationTarget } from '@/common/model/notification';
import type { NotificationVerb } from '@/server/notifications/types';

/**
 * Server-side notification target derivation.
 *
 * The read path emits a **decided** target, not the inputs to a decision: the
 * server authenticated the caller and already knows their role, so the client
 * never re-derives authority to work out where a row leads. The route table
 * for these targets lives in the client (`client/service/notification-target.ts`);
 * this module produces the union, never a route.
 *
 * ## The derivation keys on `verb`, never on `object_type`
 *
 * `EditorInvited` and `EditorRevoked` both persist `object_type='calendar'`
 * with `object_id = calendarId` (see `notifications/events/index.ts`). They
 * are indistinguishable by object shape, and their targets are opposites: the
 * invited editor gets a live calendar link, the revoked editor gets nothing,
 * because their access was just removed. A switch on `object_type` would link
 * a revoked editor to a calendar they can no longer open.
 *
 * ## Invariants this derivation relies on
 *
 * These are load-bearing, currently true, and enforced elsewhere. Each has a
 * test (see `test/notification-target.test.ts` and
 * `test/integration/read-path-targets.test.ts`) so a change elsewhere fails
 * loudly instead of silently mis-routing someone.
 *
 * 1. **Report-notification recipients are authorized on the surface they are
 *    sent to.** The report audience is `getOwnersForCalendar(calendarId)` ∪
 *    `getInstanceAdmins()`; the calendar reports tab is owner-gated. Editors
 *    never receive report notifications, so `owner_report` is never emitted
 *    to someone who would land on a blocked tab. If audience resolution ever
 *    adds editors, this breaks silently.
 *
 *    The guarantee is **exact for `Flag`**, whose audience and stored
 *    `object_calendar_id` derive from the same `payload.calendarId`, and
 *    **weaker for the two admin-addressed report verbs**: `ReportEscalated`
 *    addresses instance-admins and `ReportResolved` addresses the reviewer, so
 *    neither recipient need own the report's calendar. Under role drift — a
 *    recipient addressed while an admin who reads the row after demotion — the
 *    live role read correctly returns `false` and the owner branch hands them
 *    `owner_report` for a calendar they do not own.
 *
 *    That outcome is accepted, not repaired, and is pinned by a test in
 *    `test/integration/read-path-targets.test.ts`. The resolution is "the
 *    destination enforces" (invariant 5): the reports tab checks
 *    `userCanReviewReports` server-side, `url_name` is public routing data,
 *    and the report id is already on the row as `object.id`. Gating the
 *    `owner_report` branch on a membership check would turn the stored
 *    `object_calendar_id` into a second policy surface — precisely what the
 *    DEC-013 analogue below forbids.
 * 2. **`isAdmin` wins for a dual-role viewer.** An account that is both an
 *    instance admin and the flagged calendar's owner gets `moderation_report`.
 *    A decision, not an accident of branch order.
 * 3. **Instance-admin status is the sole determinant of report surface.** A
 *    future non-admin moderator role requires updating this derivation and the
 *    moderation `mustBeAdmin` route guard together. The rule is authoritative
 *    in moderation; notifications mirrors it.
 * 4. **Every `event` target is an event the recipient can edit.** `event_edit`
 *    is an authoring surface, so a future verb that notifies a non-editor
 *    about an event must not reuse the `event` kind unchanged.
 * 5. **The admin report API enforces authorization server-side**, independently
 *    of the client route guard. The target union is an affordance and never a
 *    trust boundary — an emitted target grants nothing.
 * 6. **A report's owning calendar is immutable after creation.** That is what
 *    makes reading the denormalized `object_calendar_id` safe: a stale value
 *    would route an owner to a *different* calendar's reports tab. Unlike
 *    `object_label`, whose staleness is a feature, staleness here is a defect.
 *
 * ## `object_calendar_id` is a routing key, not an authorization input
 *
 * Mirroring DEC-013's rule for `auth_source`: a persisted column must not
 * become a second policy surface, because it duplicates authorization logic
 * and then drifts from it. The owner-vs-admin choice comes exclusively from
 * the live `loadAccountRoles` read threaded in as `ctx.isAdmin`.
 * `object_calendar_id` only supplies the url name for the owner variant's
 * link. "This row has a calendar id, therefore the viewer is an owner" is
 * never a valid inference here.
 *
 * ## NULL and unresolvable calendars are ordinary states
 *
 * `object_calendar_id` is NULL for every non-report verb, for an admin-created
 * report against a remote event (no local calendar owns it), and for every row
 * written before migration 0040. A resolvable-looking id can also miss the
 * lookup map when the calendar has since been deleted. All of these degrade to
 * `target: null` — the same shape `Follow` produces — so a client cannot
 * distinguish "not navigable for this verb" from "not resolvable for you"
 * (DEC-004: no existence disclosure).
 */

/**
 * The activity-row fields the derivation reads. Deliberately narrow: the
 * derivation must never grow a dependency on actor identity or the label
 * snapshot, and the narrow shape keeps the unit matrix free of the entity.
 */
export interface TargetActivity {
  verb: NotificationVerb;
  object_id: string;
  object_calendar_id: string | null;
}

/**
 * Per-list-call context threaded into every row's derivation.
 *
 * Both fields are resolved once per `getNotifications` call, never per row:
 * `isAdmin` from a single live `loadAccountRoles` read, `calendarUrlNames`
 * from a single batched lookup over the whole page's calendar ids.
 */
export interface TargetDerivationContext {
  /** Live instance-admin status of the caller; the sole report-surface switch. */
  isAdmin: boolean;
  /** `calendarId -> urlName` for the ids this page needs; absent = unresolvable. */
  calendarUrlNames: Map<string, string>;
}

/**
 * Absorbs a verb this derivation has never seen. The verb column is a DB enum
 * and a widened enum could reach an older switch; an inbox page load must
 * degrade that row to plain text, not fail. The `never` parameter makes adding
 * a verb to `NotificationVerb` a compile error here.
 */
function unrecognisedVerb(_verb: never): null {
  return null;
}

/**
 * The calendar id this row needs resolved to a url name, or `null` when the
 * row needs no calendar lookup at all.
 *
 * Single source of truth for the batch: `collectTargetCalendarIds` builds the
 * lookup set from this function and `deriveTarget` reads the map through it,
 * so the set collected is exactly the set consumed. A row whose id this
 * function does not return can never find a url name in the map.
 *
 * @param activity - The activity row projection
 * @param isAdmin - Live instance-admin status of the caller
 * @returns The calendar id to resolve, or null when none is needed
 */
function targetCalendarId(activity: TargetActivity, isAdmin: boolean): string | null {
  switch (activity.verb) {
    case 'EditorInvited':
      return activity.object_id;
    case 'Flag':
    case 'ReportEscalated':
    case 'ReportResolved':
      // An admin's target is addressed by report id alone, so an all-admin
      // page of report rows issues no calendar lookup whatsoever.
      return isAdmin ? null : activity.object_calendar_id;
    case 'Follow':
    case 'Announce':
    case 'EditorRevoked':
      return null;
    default:
      return unrecognisedVerb(activity.verb);
  }
}

/**
 * Collects the deduplicated set of calendar ids a page of activities needs
 * resolved, so the read path can issue one batched lookup for the whole page
 * instead of one per row.
 *
 * @param activities - Every activity row on the page, in any order
 * @param isAdmin - Live instance-admin status of the caller
 * @returns Deduplicated calendar ids; empty when the page needs no lookup
 */
export function collectTargetCalendarIds(
  activities: TargetActivity[],
  isAdmin: boolean,
): Set<string> {
  const calendarIds = new Set<string>();
  for (const activity of activities) {
    const calendarId = targetCalendarId(activity, isAdmin);
    if (calendarId !== null) {
      calendarIds.add(calendarId);
    }
  }
  return calendarIds;
}

/**
 * Decides where a single notification row leads for the caller.
 *
 * See the module docstring for the verb rules, the invariants relied upon, and
 * why unresolvable calendars degrade rather than error.
 *
 * @param activity - The activity row projection
 * @param ctx - Per-call viewer role and the page's batched url-name map
 * @returns The decided target, or null when the row renders as plain text
 */
export function deriveTarget(
  activity: TargetActivity,
  ctx: TargetDerivationContext,
): NotificationTarget | null {
  const calendarId = targetCalendarId(activity, ctx.isAdmin);
  const calendarUrlName = calendarId === null
    ? null
    : ctx.calendarUrlNames.get(calendarId) ?? null;

  switch (activity.verb) {
    case 'Follow':
      // The followed object is the recipient's own calendar and the follower
      // is already an external link on the row; there is nowhere useful to go.
      return null;
    case 'EditorRevoked':
      // Access was just removed. Linking here would offer a door that is now
      // locked — see the verb-not-object_type note in the module docstring.
      return null;
    case 'Announce':
      return { kind: 'event', eventId: activity.object_id };
    case 'EditorInvited':
      return calendarUrlName === null
        ? null
        : { kind: 'calendar', calendarUrlName };
    case 'Flag':
    case 'ReportEscalated':
    case 'ReportResolved':
      if (ctx.isAdmin) {
        return { kind: 'moderation_report', reportId: activity.object_id };
      }
      return calendarUrlName === null
        ? null
        : { kind: 'owner_report', reportId: activity.object_id, calendarUrlName };
    default:
      return unrecognisedVerb(activity.verb);
  }
}
