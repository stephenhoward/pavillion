import { DateTime } from "luxon";
import { EventEmitter } from "events";
import config from 'config';

import { Calendar } from "@/common/model/calendar";
import { WebFingerResponse } from "@/server/activitypub/model/webfinger";
import { UserProfileResponse } from "@/server/activitypub/model/userprofile";
import { ActivityPubActivity } from "@/server/activitypub/model/base";
import { ActivityPubInboxMessageEntity, EventActivityEntity, FollowedCalendarEntity, SharedEventEntity } from "@/server/activitypub/entity/activitypub";
import CalendarService from "@/server/calendar/service/calendar";


class ActivityPubService extends EventEmitter {

    constructor() {
        super();
    }

    /**
     * parse the webfinger resource format into username and domain
     * @param resource 
     * @returns { username, domain}
     */
    parseWebFingerResource(resource: string): { username: string, domain: string } {
        resource = resource.replace('acct:', '');
        let parts = resource.split('@');

        if ( parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 ) {
            return { username: parts[0], domain: parts[1] };
        }

        return { username: '', domain: '' };
    }

    /**
     * Generate a webfinger response for the provided username
     * @param urlName 
     * @param domain 
     * @returns WebFingerResponse message
     */
    // TODO: something useful with the domain info (validation?)
    async lookupWebFinger(urlName: string, domain: string): Promise<WebFingerResponse|null> {
        let calendar = await CalendarService.getCalendarByName(urlName);

        if ( calendar ) {
            return new WebFingerResponse(calendar.urlName, config.get('domain'));
        }

        return null;
    }

    /**
     * Generate an actor message for the provided username
     * @param calendarName 
     * @param domain 
     * @returns UserProfileResponse message
     */
    async lookupUserProfile(calendarName: string): Promise<UserProfileResponse|null> {
        let calendar = await CalendarService.getCalendarByName(calendarName);

        console.log(calendar);
        if ( calendar ) {
            return new UserProfileResponse(calendar.urlName, config.get('domain'));
        }

        return null;
    }

    /**
     * Add provided message to the calendar's inbox
     * @param calendar
     * @param message 
     * @returns null
     */
    // TODO permissions? block lists? rate limiting?
    async addToInbox(calendar: Calendar, message: ActivityPubActivity ): Promise<null> {
        let foundCalendar = await CalendarService.getCalendar(calendar.id);

        if ( foundCalendar === null ) {
            throw new Error('Account not found');
        }

        let messageEntity = await ActivityPubInboxMessageEntity.findByPk(message.id);
        if ( ! messageEntity ) {
            messageEntity = ActivityPubInboxMessageEntity.build({
                id: message.id,
                calendar_id: calendar.id,
                type: message.type,
                message_time: message.published,
                message: message
            });
            await messageEntity.save();
        }

        this.emit('inboxMessageAdded', { calendar_id: calendar.id, id: messageEntity.id });

        return null;
    }

    /**
     * 
     * @param calendar Retrieve messages from the outbox of the provided calendar
     * @param limit 
     * @returns a list of ActivityPubMessage objects
     */
    async readOutbox(calendar: Calendar, limit?: DateTime): Promise<ActivityPubActivity[]> {
        let messageEntities = await ActivityPubInboxMessageEntity.findAll({
            where: { calendar_id: calendar.id },
            order: [['created_at', 'DESC']]
        });

        return messageEntities.map( (message) => message.toModel() );
    }

}

export default ActivityPubService;
