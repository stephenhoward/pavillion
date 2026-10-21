import type { RouteLocationRaw } from 'vue-router';

import type { NotificationTarget } from '@/common/model/notification';

/**
 * The route table for notification targets. It lives in the client because
 * nothing on the server consumes routes — keeping it beside the union in
 * `common/` would make vue-router types reachable from a server domain.
 * `RouteLocationRaw` is imported as a type only, so this module adds no
 * runtime framework dependency.
 */

/**
 * Absorbs a `kind` this client has never seen. An SPA serves cached bundles,
 * so a newer server can emit a target kind an older client does not know;
 * that row degrades to plain text rather than breaking. The `never` parameter
 * makes adding a variant to `NotificationTarget` a compile error here.
 */
function unrecognisedKind(_target: never): null {
  return null;
}

/**
 * Maps a server-decided notification target to the route it opens.
 *
 * Takes no viewer context and reads no store: the target already encodes the
 * recipient's authority over the resource. Every target addresses a settings
 * leaf, never an index route.
 *
 * @param target - The target from `NotificationResponse['object']`
 * @returns The route to link to, or `null` when the row is not navigable
 */
export function routeFor(target: NotificationTarget | null): RouteLocationRaw | null {
  if (target === null) {
    return null;
  }

  switch (target.kind) {
    case 'event':
      return { name: 'event_edit', params: { eventId: target.eventId } };
    case 'calendar':
      // Emitted for an editor invitation. The invitee is an editor, not the
      // owner, so the link opens the first calendar leaf an editor can see.
      return { name: 'calendar_widget', params: { calendar: target.calendarUrlName } };
    case 'moderation_report':
      return { name: 'moderation_report_detail', params: { reportId: target.reportId } };
    case 'owner_report':
      // The stored ids only build the destination (DEC-015 rule 3); the reports
      // leaf's owner gate and its reportId gate decide what the viewer may open.
      return {
        name: 'calendar_report_detail',
        params: { calendar: target.calendarUrlName, reportId: target.reportId },
      };
    default:
      return unrecognisedKind(target);
  }
}
