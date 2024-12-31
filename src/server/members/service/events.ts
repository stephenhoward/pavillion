import { v4 as uuidv4 } from 'uuid';

import { Account } from "@/common/model/account"
import { CalendarEvent, CalendarEventContent, CalendarEventSchedule } from "@/common/model/events"
import { EventContentEntity, EventEntity, EventScheduleEntity } from "@/server/common/entity/event"
import { LocationEntity } from "@/server/common/entity/location";
import LocationService from "@/server/members/service/locations";

/**
 * Service class for managing events
 *
 * @remarks
 * Use this class to manage the lifecycle of events in the system
 */
class EventService {

    /**
     * retrieves the events for the provided account
     * @param account
     * @returns a promise that resolves to the list of events
     */
    static async listEvents(account: Account): Promise<CalendarEvent[]> {

        const events = await EventEntity.findAll({
            where: { account_id: account.id },
            include: [EventContentEntity, LocationEntity, EventScheduleEntity]
        });

        return events.map( (event) => {
            let e = event.toModel();
            if ( event.content ) {
                for ( let c of event.content ) {
                    e.addContent( c.toModel() );
                }
            }
            if ( event.location ) {
                e.location = event.location.toModel();
            }
            if ( event.schedules ) {
                for ( let s of event.schedules ) {
                    e.addSchedule( s.toModel() );
                }
            }

            return e;
        });
    }

    /**
     * Creates a new event for the provided account
     * @param account - account the event belongs to
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
    static async createEvent(account: Account, eventParams:Record<string,any>): Promise<CalendarEvent> {

        eventParams.id = uuidv4();

        const event = CalendarEvent.fromObject(eventParams);
        const eventEntity = EventEntity.fromModel(event);
        eventEntity.account_id = account.id;

        if( eventParams.location ) {

            let location = await LocationService.findOrCreateLocation(account, eventParams.location);
            eventEntity.location_id = location.id;
            event.location = location;
        }

        eventEntity.save();

        if ( eventParams.content ) {
            for( let [language,content] of Object.entries(eventParams.content) ) {
                event.addContent(await EventService.createEventContent(event.id, language, content as Record<string,any>));
            }
        }

        if ( eventParams.schedules ) {
            for( let schedule of eventParams.schedules ) {
                event.addSchedule(await EventService.createEventSchedule(event.id, schedule as Record<string,any>));
            }
        }

        return event;
    }

    static async createEventSchedule(eventId: string, scheduleParams: Record<string,any>): Promise<CalendarEventSchedule> {
        const schedule = CalendarEventSchedule.fromObject(scheduleParams);

        schedule.id = uuidv4();
        const scheduleEntity = EventScheduleEntity.fromModel(schedule);
        scheduleEntity.event_id = eventId;
        await scheduleEntity.save();

        return schedule;
    }

    static async createEventContent(eventId: string, language: string, contentParams: Record<string,any>): Promise<CalendarEventContent> {
        contentParams.language = language;
        const content = CalendarEventContent.fromObject(contentParams);

        const contentEntity = EventContentEntity.fromModel(content);
        contentEntity.id = uuidv4();
        contentEntity.event_id = eventId;
        await contentEntity.save();

        return content;
    }

    /**
     * updates the event with the provided id
     * @param eventId - the id of the event to update
     * @param eventParams - the parameters and values to update for the event
     * @returns a promise that resolves to the Event
     */
    static async updateEvent(account: Account, eventId: string, eventParams:Record<string,any>): Promise<CalendarEvent> {
        const eventEntity = await EventEntity.findByPk(eventId);

        if ( ! eventEntity ) {
            throw new Error('Event not found');
        }

        if ( eventEntity.account_id !== account.id ) {
            throw( new Error('account does not own event') );
        }

        let event = eventEntity.toModel();

        if ( eventParams.content ) {
            for( let [language,content] of Object.entries(eventParams.content) ) {
                let contentEntity = await EventContentEntity.findOne({
                    where: { event_id: eventId, language: language }
                });

                if ( contentEntity ) {

                    if ( ! content ) {
                        await contentEntity.destroy();
                        continue;
                    }

                    let c = content as Record<string,any>;
                    delete c.language;

                    if ( Object.keys(c).length === 0 ) {
                        await contentEntity.destroy();
                        continue;
                    }

                    await contentEntity.update({
                        name: c.name,
                        description: c.description
                    });
                    event.addContent(contentEntity.toModel());
                }
                else {
                    if ( !content ) {
                        continue;
                    }

                    let c = content as Record<string,any>;
                    delete c.language;

                    if ( Object.keys(c).length > 0 ) {
                        event.addContent(await EventService.createEventContent(eventId, language, c));
                    }
                }
            }
        }

        if ( eventEntity.location_id && ! eventParams.location ) {
            eventEntity.location_id = '';
            event.location = null;
        }
        else if( eventParams.location ) {

            let location = await LocationService.findOrCreateLocation(account, eventParams.location);
            eventEntity.location_id = location.id;
            event.location = location;
        }

        if ( eventParams.schedules ) {
            for( let schedule of eventParams.schedules ) {

                // TODO: validate schedule data so we don't store junk
                if ( schedule.id ) {
                    let scheduleEntity = await EventScheduleEntity.findOne({
                        where: { event_id: eventId, id: schedule.id }
                    });

                    if ( ! scheduleEntity ) {
                        throw Error ('Schedule not found for event');
                    }

                    await scheduleEntity.update({
                        start_date: schedule.startDate,
                        end_date: schedule.endDate,
                        frequency: schedule.frequency,
                        interval: schedule.interval,
                        count: schedule.count,
                        by_day: schedule.byDay,
                        is_exclusion: schedule.isExclusion
                    });
                    event.addSchedule(scheduleEntity.toModel());
                }
                else {
                    event.addSchedule(await EventService.createEventSchedule(eventId, schedule));
                }
            }
        }

        await eventEntity.save();

        return event;
    }
}

export default EventService;