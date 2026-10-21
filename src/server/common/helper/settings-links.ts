/**
 * Paths to client settings leaves, for links the server emits (emails).
 * Shared by every server domain that links into settings, so no domain
 * imports another for them (DEC-003).
 *
 * Settings links built outside the SPA address a leaf directly, never a
 * settings index with a query string (DEC-021 rule 6). Each literal returned
 * here is pinned on both sides of the layer boundary, by
 * `src/server/common/test/helper/settings-links.test.ts` and
 * `src/client/test/routing/settings-links-contract.test.ts`.
 */

/**
 * Path to a calendar's Reports settings page, the client route
 * `calendar_reports`. Path only: callers add the origin with `publicUrl`.
 *
 * @param urlName - The calendar's url name
 * @returns `/settings/calendar/<urlName>/reports`, with the name encoded as one segment
 */
export function calendarReportsPath(urlName: string): string {
  return `/settings/calendar/${encodeURIComponent(urlName)}/reports`;
}

/**
 * Path to one report in the instance admin's moderation settings, the client
 * route `moderation_report_detail`. Path only: callers add the origin with
 * `publicUrl`. Pinned by the same two tests as `calendarReportsPath`.
 *
 * @param reportId - The report's id
 * @returns `/settings/admin/moderation/reports/<reportId>`, with the id encoded as one segment
 */
export function adminModerationReportPath(reportId: string): string {
  return `/settings/admin/moderation/reports/${encodeURIComponent(reportId)}`;
}

/**
 * Path to the instance admin's Accounts settings page, the client route
 * `accounts`. Path only: callers add the origin with `publicUrl`. Pinned by
 * the same two tests as `calendarReportsPath`.
 *
 * @returns `/settings/admin/accounts`
 */
export function adminAccountsPath(): string {
  return '/settings/admin/accounts';
}
