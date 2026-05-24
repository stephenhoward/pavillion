import { Report } from '@/common/model/report';

export interface ReportCreatedPayload {
  report: Report;
  reporterEmail?: string;
}

export interface ReportVerifiedPayload {
  report: Report;
}

export interface ReportEscalatedPayload {
  report: Report;
  reason: string;
}

export interface ReportResolvedPayload {
  report: Report;
  reviewerId: string;
}

export interface ReportEscalationReminderPayload {
  report: Report;
}

/**
 * Bus event names.
 *
 * Colon-delimited `{domain}:{resource}:{action}` events emitted on report
 * state transitions. These are consumed by the notifications domain to
 * record activity rows and address recipients.
 *
 * The pre-existing camelCase events (`reportCreated`, `reportVerified`,
 * etc.) on this same bus are retained for the email-pipeline handlers in
 * `events/index.ts` and are not displaced by these new bus events.
 */
export const MODERATION_BUS_EVENTS = {
  REPORT_FLAGGED: 'moderation:report:flagged',
  REPORT_ESCALATED: 'moderation:report:escalated',
  REPORT_RESOLVED: 'moderation:report:resolved',
} as const;

/**
 * Payload for `moderation:report:flagged`.
 *
 * Fires after a Report row is created in either the local-form path
 * (authenticated, anonymous-verified, or administrator-initiated) or
 * the AP-inbox path (federated `Flag` activity).
 *
 * Carries the minimum fields needed by the notifications consumer:
 * `reportId` populates the activity row's `object_id`; `calendarId`
 * lets the role resolver address calendar-owners and instance-admins
 * without traversing `event.calendarId` itself; `eventId` lets the
 * snapshot label resolver prefer the flagged event's title ( * 
 * title") with a calendar-name fallback when the event lookup fails;
 * `origin` discriminates local from federated reports for activity
 * recording.
 *
 * `actorUri` carries the federated reporter's ActivityPub actor URI for
 * `origin: 'federated'` reports only. It is forwarded through to
 * `recordActivity` so the Flag actor anonymizer can derive the
 * `https://<host>` display URL for federated Flags (per
 * anonymization). The URI itself is never stored on the notification
 * activity row — the anonymizer extracts the host and discards the rest.
 * For `origin: 'local'` reports this field is undefined.
 *
 * Reporter identity (email hash, account ID, IP hash/subnet/region,
 * verification token) is deliberately excluded — reporter PII lives
 * exclusively within the moderation domain. Downstream domains read
 * the trimmed payload and re-fetch the Report by id only if needed
 * within their own privacy scope. The federated `actorUri` is not
 * considered reporter PII in the same sense: the AP actor identifier
 * is a public AP attribution that the moderation domain already stores
 * on `ReportEntity.forwarded_from_instance` (host portion) for its own
 * purposes.
 *
 * For admin-initiated reports against remote events the calendarId may
 * be null — consumers must tolerate this. `eventId` is always populated
 * since every Report references an event.
 */
export interface ReportFlaggedPayload {
  reportId: string;
  eventId: string;
  calendarId: string | null;
  origin: 'local' | 'federated';
  actorUri?: string;
}

/**
 * Payload for `moderation:report:escalated`.
 *
 * Fires from both scheduler-driven auto-escalation and admin-action
 * escalation paths (manual escalate, owner-dismiss auto-escalation,
 * threshold-based auto-escalation in `checkAutoEscalation`).
 *
 * `eventId` lets the notifications snapshot-label resolver prefer the
 * flagged event's title (per) with a
 * calendar-name fallback. Reporter identity is omitted by design — see
 * `ReportFlaggedPayload` for rationale.
 */
export interface ReportEscalatedBusPayload {
  reportId: string;
  eventId: string;
  calendarId: string | null;
  reason: string;
}

/**
 * Payload for `moderation:report:resolved`.
 *
 * Fires when an owner or admin resolves a report. The notifications
 * handler uses `reportId` to call `dismissForObject` for prior Flag
 * and ReportEscalated activity rows.
 *
 * `eventId` lets the notifications snapshot-label resolver prefer the
 * flagged event's title (per) for the
 * `ReportResolved` activity row, with calendar-name fallback. Reporter
 * identity is omitted by design — see `ReportFlaggedPayload` for
 * rationale.
 */
export interface ReportResolvedBusPayload {
  reportId: string;
  eventId: string;
  calendarId: string | null;
  reviewerId: string;
}
