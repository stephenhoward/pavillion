/**
 * Path to a calendar's Reports settings page, the client route
 * `calendar_reports`. Path only: callers add the origin with `publicUrl`.
 *
 * Settings links built outside the SPA address a leaf directly, never a
 * settings index with a query string (DEC-021 rule 6). The literal this
 * returns is pinned on both sides of the layer boundary, by
 * `src/server/moderation/test/model/settings-links.test.ts` and
 * `src/client/test/routing/settings-links-contract.test.ts`.
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
