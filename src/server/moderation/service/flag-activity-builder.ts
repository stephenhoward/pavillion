import { v4 as uuidv4 } from 'uuid';

import { Report } from '@/common/model/report';
import { CalendarEvent } from '@/common/model/events';

/**
 * Hashtag representation for ActivityPub Flag activities.
 */
interface Hashtag {
  type: 'Hashtag';
  name: string;
}

/**
 * ActivityPub Flag activity structure for content reporting.
 */
interface FlagActivity {
  '@context'?: string;
  type: 'Flag';
  id: string;
  actor: string;
  attributedTo?: string;
  object: string;
  content: string;
  tag: Hashtag[];
  summary: string;
  published: string;
}

/**
 * Service for building ActivityPub Flag activities for report forwarding.
 *
 * This builder creates Flag activity JSON that conforms to ActivityPub standards
 * for content reporting. Supports both standard owner-level flags and admin-level
 * flags with priority metadata.
 */
class FlagActivityBuilder {
  private domain: string;

  /**
   * Creates a new FlagActivityBuilder.
   *
   * @param domain - The domain of this instance (e.g., "local.instance.example")
   */
  constructor(domain: string) {
    this.domain = domain;
  }

  /**
   * Builds a standard owner-level Flag activity for a report.
   *
   * @param report - The report being forwarded
   * @param event - The event being reported
   * @param actorUri - The URI of the actor sending the flag (usually calendar owner)
   * @param eventOriginUri - Optional explicit event URI (for remote events)
   * @returns Flag activity object conforming to ActivityPub spec
   */
  buildFlagActivity(
    report: Report,
    event: CalendarEvent,
    actorUri: string,
    eventOriginUri?: string,
  ): FlagActivity {
    // Generate unique Flag ID
    const flagId = `https://${this.domain}/flags/${uuidv4()}`;

    // Determine object URI (event being reported)
    const objectUri = eventOriginUri || `https://${this.domain}/events/${event.id}`;

    // Build category hashtag
    const categoryTag: Hashtag = {
      type: 'Hashtag',
      name: `#${report.category}`,
    };

    // Generate summary with category
    const summary = `Event report: ${report.category}`;

    // Build activity
    const activity: FlagActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: flagId,
      actor: actorUri,
      object: objectUri,
      content: report.description,
      tag: [categoryTag],
      summary,
      published: report.createdAt.toISOString(),
    };

    return activity;
  }

  /**
   * Builds an admin-level Flag activity with priority metadata.
   *
   * @param report - The admin report being forwarded
   * @param event - The event being reported
   * @param adminActorUri - The URI of the admin actor sending the flag
   * @param eventOriginUri - Optional explicit event URI (for remote events)
   * @returns Admin Flag activity with priority tags
   */
  buildAdminFlagActivity(
    report: Report,
    event: CalendarEvent,
    adminActorUri: string,
    eventOriginUri?: string,
  ): FlagActivity {
    // Generate unique Flag ID
    const flagId = `https://${this.domain}/flags/${uuidv4()}`;

    // Determine object URI (event being reported)
    const objectUri = eventOriginUri || `https://${this.domain}/events/${event.id}`;

    // Build priority level (default to low if not specified)
    const priority = report.adminPriority || 'low';

    // Build tags: admin-flag + priority
    const tags: Hashtag[] = [
      {
        type: 'Hashtag',
        name: '#admin-flag',
      },
      {
        type: 'Hashtag',
        name: `#priority-${priority}`,
      },
    ];

    // Generate summary
    const summary = `Admin report: ${report.category}`;

    // Build activity (no @context for admin flags as shown in spec)
    const activity: FlagActivity = {
      type: 'Flag',
      id: flagId,
      actor: adminActorUri,
      attributedTo: adminActorUri,
      object: objectUri,
      content: report.description,
      tag: tags,
      summary,
      published: report.createdAt.toISOString(),
    };

    return activity;
  }
}

export default FlagActivityBuilder;
