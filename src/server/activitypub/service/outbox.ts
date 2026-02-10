import { DateTime } from "luxon";
import { EventEmitter } from "events";
import axios from "axios";

import { Calendar } from "@/common/model/calendar";
import { ActivityPubOutboxMessageEntity, EventActivityEntity, FollowerCalendarEntity, FollowingCalendarEntity } from "@/server/activitypub/entity/activitypub";
import { CalendarActorEntity } from "@/server/activitypub/entity/calendar_actor";
import UpdateActivity from "@/server/activitypub/model/action/update";
import DeleteActivity from "@/server/activitypub/model/action/delete";
import FollowActivity from "@/server/activitypub/model/action/follow";
import AcceptActivity from "@/server/activitypub/model/action/accept";
import AnnounceActivity from "@/server/activitypub/model/action/announce";
import CreateActivity from "@/server/activitypub/model/action/create";
import UndoActivity from "@/server/activitypub/model/action/undo";
import FlagActivity from "@/server/activitypub/model/action/flag";
import { ActivityPubObject } from "@/server/activitypub/model/base";
import CalendarInterface from "@/server/calendar/interface";
import { FEDERATION_HTTP_TIMEOUT_MS } from "@/server/activitypub/constants";

/**
 * Service responsible for processing and distributing outgoing ActivityPub messages.
 * Handles delivery of various activity types to followers and other recipients.
 */
class ProcessOutboxService {
  calendarService: CalendarInterface;

  constructor(eventBus: EventEmitter) {
    this.calendarService = new CalendarInterface(eventBus);
  }

  /**
   * Processes all unprocessed outbox messages in batches.
   *
   * @returns {Promise<void>}
   */
  async processOutboxMessages() {

    let messages: ActivityPubOutboxMessageEntity[] = [];

    do {
      messages = await ActivityPubOutboxMessageEntity.findAll({
        where: { processedAt: null },
        order: [ ['messageTime', 'ASC'] ],
        limit: 1000,
      });

      for( const message of messages ) {
        await this.processOutboxMessage(message);
      }
    } while( messages.length > 0 );
  }

  /**
   * Processes a single outbox message, determining its type and sending it to appropriate recipients.
   *
   * @param {ActivityPubOutboxMessageEntity} message - The outbox message to process
   * @returns {Promise<void>}
   * @throws {Error} If no calendar is found for the message
   */
  async processOutboxMessage(message: ActivityPubOutboxMessageEntity) {
    let calendar = await this.calendarService.getCalendar(message.calendar_id);

    if ( ! calendar ) {
      throw new Error("No calendar found for message");
    }

    let activity = null;
    let recipients: string[] = [];

    console.log(`[OUTBOX] Processing ${message.type} activity for calendar ${calendar.urlName}`);

    switch( message.type ) {
      case 'Create':
        activity = CreateActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Create activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Update':
        activity = UpdateActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Update activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Delete':
        activity = DeleteActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Delete activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Follow':
        activity = FollowActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Follow activity');
        }
        // For Follow activities, send to the calendar being followed (the object)
        if (typeof activity.object === 'string') {
          recipients = [activity.object];
        }
        break;
      case 'Accept':
        activity = AcceptActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Accept activity');
        }
        // For Accept activities, send to the actor of the original Follow
        if (activity.object && typeof activity.object === 'object' && activity.object.actor) {
          recipients = [activity.object.actor];
        }
        break;
      case 'Announce':
        activity = AnnounceActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Announce activity');
        }
        recipients = await this.getRecipients(calendar, activity.object);
        break;
      case 'Undo':
        activity = UndoActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Undo activity');
        }
        // Check if the activity has explicit recipients in the 'to' field
        if (activity.to && activity.to.length > 0) {
          recipients = activity.to;
          console.log(`[OUTBOX] Using explicit recipients from 'to' field for Undo activity: ${recipients.join(', ')}`);
        }
        else {
          recipients = await this.getRecipients(calendar, activity.object);
        }
        break;
      case 'Flag':
        activity = FlagActivity.fromObject(message.message);
        if (!activity) {
          throw new Error('Failed to parse Flag activity');
        }
        // For Flag activities, use explicit 'to' field if present
        if (activity.to && activity.to.length > 0) {
          recipients = activity.to;
          console.log(`[OUTBOX] Using explicit recipients from 'to' field for Flag activity: ${recipients.join(', ')}`);
        }
        break;
    }

    if ( activity ) {
      console.log(`[OUTBOX] Found ${recipients.length} recipients for ${message.type} activity`);

      let deliveryErrors: string[] = [];

      for( const recipient of recipients ) {
        const inboxUrl = await this.resolveInboxUrl(recipient);

        if ( inboxUrl ) {
          try {
            console.log(`[OUTBOX] Delivering ${message.type} to ${inboxUrl}`);

            const activityData = activity.toObject();
            console.log(`[OUTBOX] Activity data:`, JSON.stringify(activityData, null, 2));

            await axios.post(inboxUrl, activityData, {
              timeout: FEDERATION_HTTP_TIMEOUT_MS,
              headers: {
                'Content-Type': 'application/activity+json',
              },
            });
            console.log(`[OUTBOX] Successfully delivered ${message.type} to ${recipient}`);
          }
          catch (error: any) {
            const errorMsg = `Failed to deliver to ${recipient}: ${error.message}`;
            console.error(`[OUTBOX] ${errorMsg}`);
            deliveryErrors.push(errorMsg);
          }
        }
        else {
          console.log(`[OUTBOX] Skipping message to ${recipient} because no inbox found`);
        }
      }

      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: deliveryErrors.length > 0
          ? `partial: ${deliveryErrors.join('; ')}`
          : 'ok',
      });
    }
    else {
      console.error(`[OUTBOX] Bad message type: ${message.type}`);
      await message.update({
        processed_time: DateTime.now().toJSDate(),
        processed_status: 'bad message type',
      });
    }
  }

  /**
   * Gets a list of recipient actor URIs for a given calendar and object.
   * Includes followers of the calendar and calendars that have shared the specific object.
   *
   * @param {Calendar} calendar - The source calendar
   * @param {ActivityPubObject|string} object - The ActivityPub object or its ID
   * @returns {Promise<string[]>} List of recipient actor URIs
   */
  async getRecipients(calendar: Calendar, object: ActivityPubObject|string): Promise<string[]> {
    let recipients: string[] = [];

    // Get followers with their CalendarActorEntity to get the actor_uri
    const followers = await FollowerCalendarEntity.findAll({
      where: { calendar_id: calendar.id },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    for (const follower of followers) {
      if (follower.calendarActor?.actor_uri) {
        recipients.push(follower.calendarActor.actor_uri);
      }
    }

    const object_id = typeof object === 'string' ? object : object.id;

    // Check if the object is a Follow ID (for Undo(Follow) activities)
    // Follow IDs have the format: https://domain/calendars/calendar/follows/uuid
    if (object_id.includes('/follows/')) {
      console.log(`[OUTBOX] Detected Follow ID in object, looking up follow relationship: ${object_id}`);
      const followEntity = await FollowingCalendarEntity.findOne({
        where: { id: object_id },
        include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
      });
      if (followEntity?.calendarActor?.actor_uri) {
        console.log(`[OUTBOX] Found follow relationship, adding recipient: ${followEntity.calendarActor.actor_uri}`);
        recipients.push(followEntity.calendarActor.actor_uri);
      }
      else {
        console.log(`[OUTBOX] No follow relationship found for ID: ${object_id}`);
      }
    }

    // Get event activity observers with their CalendarActorEntity to get the actor_uri
    const observers = await EventActivityEntity.findAll({
      where: { event_id: object_id },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    });
    for (const observer of observers) {
      if (observer.calendarActor?.actor_uri) {
        recipients.push(observer.calendarActor.actor_uri);
      }
    }

    return recipients;
  }

  /**
   * Resolves the inbox URL for a remote user by fetching their profile.
   *
   * @param {string} remote_user - The remote user identifier (username@domain or full actor URL)
   * @returns {Promise<string|null>} The inbox URL if found, otherwise null
   */
  async resolveInboxUrl(remote_user: string): Promise<string|null> {
    let profileUrl: string | null = null;

    console.log(`[OUTBOX] Resolving inbox for recipient: ${remote_user}`);

    // Check if remote_user is a full URL (starts with http:// or https://)
    if (remote_user.startsWith('http://') || remote_user.startsWith('https://')) {
      // It's a full actor URL, use it directly as the profile URL
      profileUrl = remote_user;
      console.log(`[OUTBOX] Using full URL as profile URL: ${profileUrl}`);
    }
    else {
      // It's a username@domain format, resolve via WebFinger
      profileUrl = await this.fetchProfileUrl(remote_user);
      console.log(`[OUTBOX] Resolved WebFinger profile URL: ${profileUrl}`);
    }

    if ( profileUrl ) {
      console.log(`[OUTBOX] Fetching actor document from: ${profileUrl}`);
      let response = await axios.get(profileUrl, { timeout: FEDERATION_HTTP_TIMEOUT_MS });

      if ( response && response.data ) {
        console.log(`[OUTBOX] Resolved inbox URL: ${response.data.inbox}`);
        return response.data.inbox;
      }
    }

    console.log(`[OUTBOX] Failed to resolve inbox for ${remote_user}`);
    return null;
  }

  /**
   * Fetches the profile URL for a remote user using WebFinger protocol.
   *
   * @param {string} remote_user - The remote user identifier (username@domain)
   * @returns {Promise<string|null>} The profile URL if found, otherwise null
   */
  async fetchProfileUrl(remote_user: string): Promise<string|null> {
    const [username, domain] = remote_user.split('@');
    console.log(`[OUTBOX] WebFinger lookup for ${remote_user}: username=${username}, domain=${domain}`);

    if ( username && domain ) {
      const webfingerUrl = 'https://' + domain + '/.well-known/webfinger?resource=acct:' + username + '@' + domain;
      console.log(`[OUTBOX] Fetching WebFinger from: ${webfingerUrl}`);

      try {
        let response = await axios.get(webfingerUrl, { timeout: FEDERATION_HTTP_TIMEOUT_MS });

        if ( response && response.data && response.data.links ) {
          const profileLink = (await response).data.links.filter((link: any) => link.rel === 'self');
          if ( profileLink.length > 0 ) {
            console.log(`[OUTBOX] WebFinger resolved to: ${profileLink[0].href}`);
            return profileLink[0].href;
          }
        }
      }
      catch (error: any) {
        console.error(`[OUTBOX] WebFinger lookup failed: ${error.message}`);
      }
    }
    return null;
  }
}

export default ProcessOutboxService;
