/**
 * A deleted event's IRIs answer 410, end to end.
 *
 * The event tables keep nothing of a deleted event, so the object routes tell
 * "deleted" from "never existed" by the calendar's own stored public Delete
 * (DEC-024). The probe skips the served-set filter, so these tests leave the
 * Delete rows unprocessed: a peer that re-fetches as soon as it receives the
 * Delete must already see 410.
 *
 * Nothing listens on the event buses here; each test calls the delete handler
 * itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import ActivityPubServerRoutes from '@/server/activitypub/api/v1/server';
import { EventObject } from '@/server/activitypub/model/object/event';
import { NoteObject } from '@/server/activitypub/model/object/note';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

interface Answer {
  status: number;
  body: unknown;
  contentType?: string;
}

describe('Deleted object IRIs answer 410 Gone', () => {
  let env: TestEnvironment;
  let accountsInterface: AccountsInterface;
  let calendarInterface: CalendarInterface;
  let apInterface: ActivityPubInterface;
  let handlers: ActivityPubEventHandlers;
  let routes: ActivityPubServerRoutes;
  let owner: Account;
  let origin: Calendar;
  let other: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    await configurationInterface.setSetting('registrationMode', 'open');
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, new SetupInterface(), new EmailInterface());
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    apInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
    handlers = new ActivityPubEventHandlers(
      apInterface,
      calendarInterface,
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
    );
    routes = new ActivityPubServerRoutes(apInterface, calendarInterface);

    owner = await accountsInterface.registerNewAccount('gone-owner@pavillion.dev') as Account;
    origin = await calendarInterface.createCalendar(owner, 'goneorigin');
    other = await calendarInterface.createCalendar(owner, 'goneother');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  async function createEvent(): Promise<CalendarEvent> {
    return calendarInterface.createEvent(owner, {
      calendarId: origin.id,
      content: { en: { name: 'doomed', description: 'about to be deleted' } },
      start_date: '2026-05-08',
      start_time: '18:00',
      end_date: '2026-05-08',
      end_time: '20:00',
    });
  }

  async function request(handler: 'getEvent' | 'getNote', urlname: string, eventid: string): Promise<Answer> {
    const answer: Answer = { status: 200, body: undefined };
    const res = {
      status(code: number) {
        answer.status = code;
        return res;
      },
      send(body: unknown) {
        answer.body = body;
        return res;
      },
      json(body: unknown) {
        answer.body = body;
        return res;
      },
      setHeader(name: string, value: string) {
        if (name === 'Content-Type') {
          answer.contentType = value;
        }
      },
    };
    await routes[handler]({ params: { urlname, eventid } } as any, res as any);
    return answer;
  }

  async function deleteEvent(event: CalendarEvent): Promise<void> {
    const emit = handlers as unknown as Record<string, (payload: unknown) => Promise<void>>;
    await calendarInterface.deleteEvent(owner, event.id, origin.id);
    await emit.handleEventDeleted({ calendar: origin, event });
  }

  it('answers 410 with a bare Tombstone on both IRIs while the Delete is unprocessed', async () => {
    const event = await createEvent();
    expect((await request('getEvent', origin.urlName, event.id)).status, 'fixture: live event').toBe(200);

    await deleteEvent(event);

    const rows = await ActivityPubOutboxMessageEntity.findAll({ where: { calendar_id: origin.id, type: 'Delete' } });
    expect(rows.every(row => row.processed_time === null), 'fixture: Delete rows unprocessed').toBe(true);

    const eventAnswer = await request('getEvent', origin.urlName, event.id);
    expect(eventAnswer.status).toBe(410);
    expect(eventAnswer.contentType).toBe('application/activity+json');
    expect(eventAnswer.body).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: EventObject.eventUrl(origin, event.id),
      type: 'Tombstone',
    });

    const noteAnswer = await request('getNote', origin.urlName, event.id);
    expect(noteAnswer.status).toBe(410);
    expect(noteAnswer.body).toEqual({
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: NoteObject.noteUrl(origin, event.id),
      type: 'Tombstone',
    });
  });

  it('answers 404 for an event that never existed', async () => {
    const id = uuidv4();
    expect((await request('getEvent', origin.urlName, id)).status).toBe(404);
    expect((await request('getNote', origin.urlName, id)).status).toBe(404);
  });

  it('answers 404 when the stored Delete is not public', async () => {
    const event = await createEvent();
    await deleteEvent(event);
    await ActivityPubOutboxMessageEntity.update({ is_public: false }, { where: { calendar_id: origin.id, type: 'Delete' } });

    // Other events' Deletes were flipped too; only this event's IRI matters.
    expect((await request('getEvent', origin.urlName, event.id)).status).toBe(404);
    expect((await request('getNote', origin.urlName, event.id)).status).toBe(404);
  });

  it('answers 404 under a calendar that did not publish the Delete', async () => {
    const event = await createEvent();
    await deleteEvent(event);

    expect((await request('getEvent', origin.urlName, event.id)).status, 'fixture: anchoring calendar').toBe(410);
    expect((await request('getEvent', other.urlName, event.id)).status).toBe(404);
    expect((await request('getNote', other.urlName, event.id)).status).toBe(404);
  });

  it('answers 404 when the Delete is anchored on another calendar', async () => {
    const event = await createEvent();
    await deleteEvent(event);
    await ActivityPubOutboxMessageEntity.update(
      { calendar_id: other.id },
      { where: { id: [`${EventObject.eventUrl(origin, event.id)}/delete`, `${NoteObject.noteUrl(origin, event.id)}/delete`] } },
    );

    expect((await request('getEvent', origin.urlName, event.id)).status).toBe(404);
    expect((await request('getNote', origin.urlName, event.id)).status).toBe(404);
  });
});
