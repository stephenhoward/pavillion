/**
 * Centralized logging utility for ActivityPub activity rejections.
 *
 * This module provides structured logging for all scenarios where incoming
 * ActivityPub activities are rejected, enabling consistent monitoring and
 * troubleshooting of federation issues.
 */

import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

export type RejectionType =
  | 'blocked_instance'
  | 'unauthorized_editor'
  | 'ownership_verification_failed'
  | 'parse_failure'
  | 'invalid_object'
  | 'no_relationship';

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
 * Log level is automatically set to 'warn' for most rejections
 * and 'error' for parse failures.
 *
 * @param context - Complete context information about the rejection
 */
export function logActivityRejection(context: RejectionContext): void {
  const logData = {
    rejectionType: context.rejection_type,
    activityType: context.activity_type,
    actorUri: context.actor_uri,
    actorDomain: context.actor_domain,
    calendarId: context.calendar_id,
    calendarUrlName: context.calendar_url_name,
    messageId: context.message_id,
    additionalContext: context.additional_context,
  };

  if (context.rejection_type === 'parse_failure') {
    logger.error(logData, `inbox rejection: ${context.reason}`);
  }
  else {
    logger.warn(logData, `inbox rejection: ${context.reason}`);
  }
}
