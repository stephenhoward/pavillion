import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Account } from "../../../common/model/account"
import { EventContentEntity, EventEntity } from "../../common/entity/event"
import { CalendarEvent, CalendarEventContent } from "../../../common/model/events"

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

        const events = await EventEntity.findAll({ where: { accountId: account.id }, include: [EventContentEntity] });

        return events.map( (event) => {
            let e = event.toModel();
            if ( event.content ) {
                for ( let c of event.content ) {
                    e.addContent( c.toModel() );
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
        eventEntity.accountId = account.id;
        eventEntity.save();

        for( let [language,strings] of Object.entries(eventParams.content) ) {
            let c = strings as Record<string,any>;
            c.language = language;

            const content = CalendarEventContent.fromObject(c);

            const contentEntity = EventContentEntity.fromModel(content);
            contentEntity.id = uuidv4();
            contentEntity.event_id = event.id;
            contentEntity.save();

            event.addContent(content);
        }

        return event;
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

        if ( eventEntity.accountId !== account.id ) {
            throw( new Error('account does not own event') );
        }

        let event = eventEntity.toModel();

        // TODO: handle dropping languages
        // TODO: creating missing languages
        for( let [language,content] of Object.entries(eventParams.content) ) {
            const contentEntity = await EventContentEntity.findOne({
                where: { event_id: eventId, language: language }
            });

            if ( contentEntity ) {
                let c = content as Record<string,any>;
                contentEntity.update({
                    name: c.name,
                    description: c.description
                });
                await contentEntity.save();
                event.addContent(contentEntity.toModel());
            }
        }

        return event;
    }

}

export default EventService;