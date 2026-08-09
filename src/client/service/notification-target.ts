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
 * recipient's authority over the resource.
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
      return { name: 'calendar_management', params: { calendar: target.calendarUrlName } };
    case 'moderation_report':
      return { name: 'moderation_report_detail', params: { reportId: target.reportId } };
    case 'owner_report':
      return {
        name: 'calendar_management',
        params: { calendar: target.calendarUrlName },
        query: { tab: 'reports', report: target.reportId },
      };
    default:
      return unrecognisedKind(target);
  }
}
