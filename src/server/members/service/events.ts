import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Account } from "../../../common/model/account"
import { EventEntity } from "../../common/entity/event"
import { CalendarEvent } from "../../../common/model/events"

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

        const events = await EventEntity.findAll({ where: { account_id: account.id } });

        return events.map( (event) => event.toModel() );
    }

    /**
     * Creates a new event for the provided account
     * @param account - account the event belongs to
     * @param eventParams - the parameters for the new event
     * @returns a promise that resolves to the created Event
     */
    static async createEvent(account: Account, eventParams:Record<string,any>): Promise<CalendarEvent> {

        // TODO: validation
        const event = EventEntity.build({
            id: uuidv4(),
            account_id: account.id,
            ...eventParams
        });

        await event.save();

        return event.toModel();
    }

    /**
     * updates the event with the provided id
     * @param eventId - the id of the event to update
     * @param eventParams - the parameters and values to update for the event
     * @returns a promise that resolves to the Event
     */
    static async updateEvent(account: Account, eventId: string, eventParams:Record<string,any>): Promise<CalendarEvent> {
        const event = await EventEntity.findByPk(eventId);

        if ( ! event ) {
            throw new Error('Event not found');
        }

        if ( event.accountId !== account.id ) {
            throw( new Error('account does not own event') );
        }

        // TODO: validation
        event.update(eventParams);
        await event.save();
        return event.toModel();
    }

}

export default EventService;