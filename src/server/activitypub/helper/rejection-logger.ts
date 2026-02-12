/**
 * Centralized logging utility for ActivityPub activity rejections.
 *
 * This module provides structured logging for all scenarios where incoming
 * ActivityPub activities are rejected, enabling consistent monitoring and
 * troubleshooting of federation issues.
 */

export type RejectionType =
  | 'blocked_instance'
  | 'unauthorized_editor'
  | 'ownership_verification_failed'
  | 'parse_failure'
  | 'invalid_object';

export interface RejectionContext {
  rejection_type: RejectionType;
  activity_type: string;
  actor_uri: string;
  actor_domain: string;
  calendar_id?: string;
  calendar_url_name?: string;
  reason: string;
  message_id?: string;
  additional_context?: Record<string, unknown>;
}

/**
 * Logs an ActivityPub activity rejection with structured context information.
 *
 * Outputs a JSON-formatted log entry with all relevant details for monitoring
 * and troubleshooting rejected federation activities. Log level is automatically
 * set to 'warn' for most rejections and 'error' for parse failures.
 *
 * @param context - Complete context information about the rejection
 */
export function logActivityRejection(context: RejectionContext): void {
  const timestamp = new Date().toISOString();
  const level = context.rejection_type === 'parse_failure' ? 'error' : 'warn';

  const logEntry = {
    timestamp,
    level,
    context: 'activitypub.inbox.rejection',
    rejection_type: context.rejection_type,
    activity_type: context.activity_type,
    actor_uri: context.actor_uri,
    actor_domain: context.actor_domain,
    calendar_id: context.calendar_id,
    calendar_url_name: context.calendar_url_name,
    reason: context.reason,
    message_id: context.message_id,
    additional_context: context.additional_context,
  };

  const logMessage = JSON.stringify(logEntry, null, 2);

  if (level === 'error') {
    console.error(logMessage);
  }
  else {
    console.warn(logMessage);
  }
}
