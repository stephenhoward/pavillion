import { EventEmitter } from 'events';
import config from 'config';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { InsufficientCalendarPermissionsError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { FederationDeliveryError } from '@/common/exceptions/activitypub';
import CalendarInterface from '@/server/calendar/interface';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import type { CalendarActor } from '@/server/activitypub/entity/calendar_actor';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import AddActivity from '@/server/activitypub/model/action/add';
import { addToOutbox as addToOutboxHelper } from '@/server/activitypub/helper/outbox';
import { logError } from '@/server/common/helper/error-logger';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('activitypub');

/**
 * Loose-typed view of ProcessOutboxService restricted to the surface
 * FederationPublisher actually uses. The full class lives in
 * `@/server/activitypub/service/outbox` but is not imported as a hard
 * dependency to keep this service unit-testable without spinning up the
 * full outbox worker.
 */
interface OutboxDeliverySurface {
  deliverActivitySigned(
    signingActorUri: string,
    activity: Record<string, any>,
    inboxUrl: string,
  ): Promise<{ status: number; data: any }>;
}

/**
 * Typed input shape accepted by publishEventCreate / publishEventUpdate.
 * The current call sites in events.ts work in `(eventId, eventParams)` form,
 * so we keep that shape verbatim. A typed CalendarEvent refactor is
 * deliberately deferred — wire format compatibility with the pre-migration
 * implementation is the success criterion for pv-yowo.
 */
export interface FederationEventInput {
  eventId: string;
  eventParams: Record<string, any>;
}

/**
 * Minimal shape required for sendEditorInvite. The Add activity addresses
 * the remote user actor URI explicitly; the inbox is resolved at delivery
 * time by the outbox worker.
 */
export interface FederationRemoteUserActor {
  actorUri: string;
  inbox?: string;
}

/**
 * FederationPublisher
 *
 * AP-domain service responsible for constructing and dispatching outbound
 * event-lifecycle activities (Create / Update / Delete) and editor-invite
 * Add activities. Activity construction was previously inlined into the
 * calendar domain (`events.ts`, `calendar.ts`); pv-yowo moves it here so
 * the AP domain owns its own wire format.
 *
 * Signing-actor table (per pv-dyyw):
 *   - Create / Update / Delete on a remote calendar -> signed by user actor
 *     (activity.actor = userActorUri). Resolved via UserActorEntity.findOne.
 *   - Add editor invite                              -> signed by calendar
 *     actor (activity.actor = calendarActorUri). Built from local domain +
 *     calendar.urlName.
 *
 * Delivery posture:
 *   - publishEventCreate is synchronous because the caller reads the remote
 *     response body to construct the local CalendarEvent model. Errors are
 *     mapped to InsufficientCalendarPermissionsError on 403, generic Error
 *     on other non-2xx, and generic Error on FederationDeliveryError.
 *   - publishEventUpdate, publishEventDelete, sendEditorInvite are
 *     fire-and-forget via the outbox helper. Delivery errors surface
 *     asynchronously through the outbox worker.
 */
class FederationPublisher {

  private eventBus: EventEmitter;
  private calendarInterface: CalendarInterface;
  private outboxService: OutboxDeliverySurface;

  /**
   * @param eventBus - Shared event bus for outbox notifications.
   * @param calendarInterface - Used to resolve the outbox anchor calendar
   *   for user-actor activities (editableCalendarsForUser).
   * @param outboxService - ProcessOutboxService instance for synchronous
   *   signed delivery (publishEventCreate). Typed loosely so this service
   *   stays unit-testable.
   */
  constructor(
    eventBus: EventEmitter,
    calendarInterface: CalendarInterface,
    outboxService: OutboxDeliverySurface,
  ) {
    this.eventBus = eventBus;
    this.calendarInterface = calendarInterface;
    this.outboxService = outboxService;
  }

  /**
   * Resolves the actor URI signed by user-actor activities. Reads
   * UserActorEntity directly to avoid calling back through
   * ActivityPubInterface (this service lives inside the AP domain).
   *
   * @param account - The local account whose user actor to resolve.
   * @returns The user actor URI string.
   * @throws InsufficientCalendarPermissionsError if the account has no
   *   user actor configured.
   */
  private async resolveUserActorUri(account: Account): Promise<string> {
    const userActor = await UserActorEntity.findOne({
      where: { account_id: account.id },
    });
    if (!userActor || !userActor.actor_uri) {
      throw new InsufficientCalendarPermissionsError(
        'User does not have an ActivityPub identity configured',
      );
    }
    return userActor.actor_uri;
  }

  /**
   * Resolves the local calendar used to anchor an outbox row for a
   * user-actor activity. Outbox rows require a calendar_id FK; for
   * user-actor activities no specific calendar is semantically the
   * "owner" so we pick the first calendar the user can edit. Delivery
   * routing is driven by the activity's explicit `to` field, not by
   * this anchor calendar.
   *
   * @param account - The local account performing the activity.
   * @returns The Calendar to use as the outbox anchor.
   * @throws InsufficientCalendarPermissionsError if the account has no
   *   editable local calendar.
   */
  private async resolveOutboxAnchor(account: Account): Promise<Calendar> {
    const userCalendars = await this.calendarInterface.editableCalendarsForUser(account);
    if (userCalendars.length === 0) {
      throw new InsufficientCalendarPermissionsError(
        'User has no local calendar to anchor outbox delivery',
      );
    }
    return userCalendars[0];
  }

  /**
   * Builds an ISO 8601 date-time string from date and time parts.
   * Mirrors the pre-migration helper in events.ts so the wire format
   * matches byte-for-byte.
   *
   * @param date - Date string in YYYY-MM-DD form.
   * @param time - Optional time string in HH:MM form.
   * @returns ISO date-time string, or empty string when date is falsy.
   */
  private buildIsoDateTime(date: string, time?: string): string {
    if (!date) return '';
    if (time) {
      return `${date}T${time}:00`;
    }
    return `${date}T00:00:00`;
  }

  /**
   * Publishes a Create(Event) activity to a remote calendar. Synchronous —
   * reads the remote response body so the caller can construct a local
   * CalendarEvent model from the echoed event. Use this only when the
   * caller MUST consume the response (currently only the event-creation
   * call site qualifies).
   *
   * Wire format and error mapping mirror the pre-migration implementation
   * in events.ts:357-534 byte-for-byte (only the activity id uuid differs).
   *
   * @param account - The local account creating the event.
   * @param event - The event input (eventId + raw eventParams).
   * @param remoteCalendarActor - The remote calendar's CalendarActor.
   * @returns The created CalendarEvent (from remote response, or a synthetic
   *   fallback when the remote returns 2xx with no parseable body).
   * @throws InsufficientCalendarPermissionsError on 403 from the remote
   *   inbox, or when the account has no user actor.
   * @throws CalendarNotFoundError when the remote calendar has no inbox URL.
   * @throws Error with `[AP] Failed to create event on remote calendar` prefix
   *   on FederationDeliveryError or other non-2xx responses.
   */
  async publishEventCreate(
    account: Account,
    event: FederationEventInput,
    remoteCalendarActor: CalendarActor,
  ): Promise<CalendarEvent> {
    const actorUri = await this.resolveUserActorUri(account);

    const inboxUrl = remoteCalendarActor.inboxUrl;
    if (!inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    const localDomain = config.get<string>('domain');
    const { eventId, eventParams } = event;

    // Build the ActivityPub Create activity. Wire format matches the
    // pre-migration implementation in events.ts:445-463 byte-for-byte
    // (only the activity id uuid differs across runs).
    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Create',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: actorUri,
      to: [remoteCalendarActor.actorUri],
      object: {
        type: 'Event',
        id: `https://${localDomain}/events/${eventId}`,
        name: eventParams.content?.en?.name || eventParams.name || 'Untitled Event',
        summary: eventParams.content?.en?.description || eventParams.description || '',
        startTime: this.buildIsoDateTime(eventParams.start_date, eventParams.start_time),
        endTime: this.buildIsoDateTime(eventParams.end_date, eventParams.end_time),
        attributedTo: actorUri,
        calendarId: remoteCalendarActor.id,
        eventParams: eventParams,
      },
    };

    logger.info({ inboxUrl }, 'Sending Create activity to remote calendar');

    let response: { status: number; data: any };
    try {
      response = await this.outboxService.deliverActivitySigned(actorUri, createActivity, inboxUrl);
    }
    catch (error: any) {
      logError(error, '[AP] Failed to create event on remote calendar');
      if (error instanceof FederationDeliveryError) {
        throw new Error(`[AP] Failed to create event on remote calendar: ${error.message}`);
      }
      throw error;
    }

    // 403 from the remote: caller is not authorized. The new contract
    // surfaces this as a resolved { status: 403, data: null } object
    // rather than an axios error, so check status directly.
    if (response.status === 403) {
      throw new InsufficientCalendarPermissionsError(
        'You are not authorized to create events on this calendar',
      );
    }

    if (response.status < 200 || response.status >= 300) {
      logError(
        new Error(`Remote inbox returned status ${response.status}`),
        '[AP] Failed to create event on remote calendar',
      );
      throw new Error(
        `[AP] Failed to create event on remote calendar: remote returned status ${response.status}`,
      );
    }

    logger.info({ status: response.status }, 'Remote calendar accepted Create activity');

    // The remote should return the created event as JSON. data may be
    // null (empty 202) or {} (empty 200 from some receivers) — guard
    // before constructing the model from it.
    if (response.data && typeof response.data === 'object' && response.data?.id) {
      return CalendarEvent.fromObject(response.data);
    }

    // Fallback: construct a local representation when no body is available.
    const fallback = new CalendarEvent(
      eventId,
      remoteCalendarActor.id,
      `https://${localDomain}/events/${eventId}`,
      false,
    );
    if (eventParams.content) {
      for (const [language, content] of Object.entries(eventParams.content)) {
        const contentObj = content as any;
        fallback.addContent(new CalendarEventContent(language, contentObj.name || '', contentObj.description || ''));
      }
    }
    return fallback;
  }

  /**
   * Publishes an Update(Event) activity to a remote calendar via the
   * outbox (fire-and-forget). The activity is signed by the user actor;
   * delivery is single-recipient via explicit `to`.
   *
   * Wire format mirrors events.ts:570-620 byte-for-byte. The local event
   * id is included in eventParams so the remote can resolve which event
   * to update.
   *
   * @param account - The local account updating the event.
   * @param event - The event input (eventId + raw eventParams).
   * @param remoteCalendarActor - The remote calendar's CalendarActor.
   * @throws InsufficientCalendarPermissionsError when the account has no
   *   user actor or no editable local calendar to anchor the outbox row.
   * @throws CalendarNotFoundError when the remote calendar has no inbox URL.
   */
  async publishEventUpdate(
    account: Account,
    event: FederationEventInput,
    remoteCalendarActor: CalendarActor,
  ): Promise<void> {
    const actorUri = await this.resolveUserActorUri(account);

    if (!remoteCalendarActor.inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    const localDomain = config.get<string>('domain');
    const { eventId, eventParams } = event;

    // Include the local event id so the remote can look it up.
    const eventParamsWithId = { ...eventParams, id: eventId };

    const updateActivityObject = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Update',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: actorUri,
      to: [remoteCalendarActor.actorUri],
      object: {
        type: 'Event',
        id: `https://${localDomain}/events/${eventId}`,
        name: eventParams.content?.en?.name || eventParams.name || 'Untitled Event',
        summary: eventParams.content?.en?.description || eventParams.description || '',
        startTime: this.buildIsoDateTime(eventParams.start_date, eventParams.start_time),
        endTime: this.buildIsoDateTime(eventParams.end_date, eventParams.end_time),
        attributedTo: actorUri,
        calendarId: remoteCalendarActor.id,
        eventParams: eventParamsWithId,
      },
    };

    const updateActivity = UpdateActivity.fromObject(updateActivityObject);
    if (!updateActivity) {
      throw new Error('Failed to construct UpdateActivity for remote event update');
    }

    const anchor = await this.resolveOutboxAnchor(account);

    logger.info({ inboxUrl: remoteCalendarActor.inboxUrl }, 'Enqueuing Update activity for remote calendar');
    await this.addToOutbox(anchor, updateActivity);
  }

  /**
   * Publishes a Delete(Tombstone) activity to a remote calendar via the
   * outbox (fire-and-forget). The activity is signed by the user actor;
   * delivery is single-recipient via explicit `to`.
   *
   * Wire format mirrors events.ts:667-712 byte-for-byte. The Tombstone
   * object preserves formerType and the local eventId so the remote can
   * resolve which event to tombstone.
   *
   * @param account - The local account deleting the event.
   * @param eventId - The local event id to delete.
   * @param remoteCalendarActor - The remote calendar's CalendarActor.
   * @throws InsufficientCalendarPermissionsError when the account has no
   *   user actor or no editable local calendar to anchor the outbox row.
   * @throws CalendarNotFoundError when the remote calendar has no inbox URL.
   */
  async publishEventDelete(
    account: Account,
    eventId: string,
    remoteCalendarActor: CalendarActor,
  ): Promise<void> {
    const actorUri = await this.resolveUserActorUri(account);

    if (!remoteCalendarActor.inboxUrl) {
      throw new CalendarNotFoundError('Remote calendar inbox URL not configured');
    }

    const localDomain = config.get<string>('domain');

    const deleteActivityObject = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Delete',
      id: `https://${localDomain}/activities/${uuidv4()}`,
      actor: actorUri,
      to: [remoteCalendarActor.actorUri],
      object: {
        type: 'Tombstone',
        id: `https://${localDomain}/events/${eventId}`,
        formerType: 'Event',
        calendarId: remoteCalendarActor.id,
        eventId: eventId,
      },
    };

    const deleteActivity = DeleteActivity.fromObject(deleteActivityObject);
    if (!deleteActivity) {
      throw new Error('Failed to construct DeleteActivity for remote event delete');
    }

    const anchor = await this.resolveOutboxAnchor(account);

    logger.info({ inboxUrl: remoteCalendarActor.inboxUrl }, 'Enqueuing Delete activity for remote calendar');
    await this.addToOutbox(anchor, deleteActivity);
  }

  /**
   * Sends an Add(remoteUserActor) editor-invite activity from a local
   * calendar to a remote user actor. The activity is signed by the
   * calendar actor (per pv-dyyw signing table) and anchored on the
   * calendar's own outbox.
   *
   * Wire format mirrors calendar.ts:788-800 byte-for-byte.
   *
   * @param calendar - The local calendar inviting the editor.
   * @param remoteUserActor - The remote user actor being invited.
   */
  async sendEditorInvite(
    calendar: Calendar,
    remoteUserActor: FederationRemoteUserActor,
  ): Promise<void> {
    const localDomain = config.get<string>('domain');
    const calendarActorUri = `https://${localDomain}/calendars/${calendar.urlName}`;
    const calendarInboxUrl = `https://${localDomain}/calendars/${calendar.urlName}/inbox`;

    const addActivity = new AddActivity(
      calendarActorUri,
      remoteUserActor.actorUri,
      `${calendarActorUri}/editors`,
    );
    addActivity.id = `${calendarActorUri}/activities/${uuidv4()}`;
    addActivity.to = [remoteUserActor.actorUri];
    addActivity.calendarId = calendar.id;
    addActivity.calendarInboxUrl = calendarInboxUrl;

    logger.info(
      { inbox: remoteUserActor.inbox, calendarId: calendar.id },
      'Enqueuing Add activity for remote user',
    );
    await this.addToOutbox(calendar, addActivity);
  }

  /**
   * Thin wrapper around the AP outbox helper so this service exposes a
   * single seam for tests to stub. Mirrors the pattern in
   * `members.ts:addToOutbox` — the helper itself is module-level and not
   * stubbable via sinon at the call site.
   *
   * @param calendar - The calendar to anchor the outbox row under.
   * @param message - The signed activity to enqueue.
   */
  async addToOutbox(calendar: Calendar, message: ActivityPubActivity): Promise<void> {
    await addToOutboxHelper(this.eventBus, calendar, message);
  }
}

export default FederationPublisher;
