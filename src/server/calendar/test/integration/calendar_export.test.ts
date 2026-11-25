import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import { DateTime } from 'luxon';
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import ical from 'node-ical';
import type { EventInstance, VEvent } from 'node-ical';

import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/helpers/emit-and-settle';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import CalendarInterface from '@/server/calendar/interface';
import { EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventInstanceEntity } from '@/server/calendar/entity/event_instance';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import { EventCategoryAssignmentEntity } from '@/server/calendar/entity/event_category_assignment';
import { CalendarMemberEntity } from '@/server/calendar/entity/calendar_member';

/**
 * GET /api/v1/calendars/:calendarId/export and /export/languages against a
 * real database: the owner's file read back by node-ical, its language, who
 * may download it, and whether it is well-formed iCalendar.
 *
 * Calendars and events are created over HTTP, so no fixture writes the
 * calendar's `languages` column (it says `en` for every calendar here) and
 * the export language set has to come from the content. Fixtures are anchored
 * to today, in explicit zones, so they neither age out nor depend on the
 * process time zone.
 */

const NEW_YORK = 'America/New_York';
const BERLIN = 'Europe/Berlin';

describe('Calendar export routes', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;

  let ownerToken: string;
  let otherToken: string;
  let editorToken: string;
  let adminToken: string;

  // The main calendar: content in en and fr, events in en, es and fr.
  let mainCalendar: { id: string; urlName: string };
  let emptyCalendar: { id: string; urlName: string };
  let brokenCalendar: { id: string; urlName: string };
  /** Content in fr first, en added after; one event in es. */
  let orderCalendar: { id: string; urlName: string };
  let ownerAccountId: string;

  /** Weekly series with one date hidden and one shown as cancelled; en + es. */
  let weeklyId: string;
  /** Weekly series plus a one-off extra date at another time. */
  let seriesPlusExtraId: string;
  /** Weekly series in Berlin. */
  let berlinId: string;
  /** One date, English only, at a place, with categories. */
  let singleId: string;
  /** One date in en, es and fr, each with accessibility notes. */
  let multilingualId: string;
  /** Another calendar's event that the main calendar reposts. */
  let repostedId: string;
  /** The broken calendar's event, whose schedule names no real zone. */
  let brokenEventId: string;

  let hiddenDate: DateTime;
  let shownCancelledDate: DateTime;
  let extraDate: DateTime;

  const now = DateTime.now();
  const windowStart = now.minus({ years: 1 });
  const windowEnd = now.plus({ years: 1 });

  const todayIn = (zone: string, hour: number, minute = 0) =>
    DateTime.now().setZone(zone).set({ hour, minute, second: 0, millisecond: 0 });

  async function createCalendar(token: string, urlName: string, content?: Record<string, { name: string }>) {
    const response = await request(env.app)
      .post('/api/v1/calendars')
      .set('Authorization', `Bearer ${token}`)
      .send({ urlName, ...(content ? { content } : {}) });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Failed to create calendar ${urlName}: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return { id: response.body.id as string, urlName: response.body.urlName as string };
  }

  async function createEvent(token: string, body: Record<string, unknown>): Promise<string> {
    const response = await request(env.app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (response.status !== 201) {
      throw new Error(`Failed to create event: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return response.body.id;
  }

  /** A schedule in an explicit zone: the ISO string carries its offset. */
  function schedule(start: DateTime, extra: Record<string, unknown> = {}) {
    return {
      start: start.toISO(),
      eventEndTime: start.plus({ hours: 2 }).toISO(),
      timezone: start.zoneName,
      ...extra,
    };
  }

  /**
   * Wait until the event's instance rows are written through its last
   * occurrence, so the listener chain does not collide with the next write
   * on the single SQLite connection. Every fixture's last occurrence is in
   * the near future, inside the materialization horizon.
   */
  async function settle(eventId: string, lastOccurrence: DateTime): Promise<void> {
    await waitFor(
      () => EventInstanceEntity.findOne({
        where: {
          event_id: eventId,
          start_time: { [Op.gte]: lastOccurrence.minus({ hours: 1 }).toJSDate() },
        },
      }),
      { timeoutMs: 8000 },
    );
  }

  async function cancelDate(eventId: string, start: DateTime, hideFromPublic: boolean): Promise<void> {
    const response = await request(env.app)
      .post(`/api/v1/events/${eventId}/occurrences/cancel`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ start: start.toUTC().toISO(), hideFromPublic });
    if (response.status !== 204) {
      throw new Error(`Failed to cancel occurrence: ${response.status} ${JSON.stringify(response.body)}`);
    }
  }

  function exportFile(token: string | null, calendarId: string, query = '') {
    const req = request(env.app).get(`/api/v1/calendars/${calendarId}/export${query}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function exportLanguages(token: string | null, calendarId: string) {
    const req = request(env.app).get(`/api/v1/calendars/${calendarId}/export/languages`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  function parseVevents(ics: string): VEvent[] {
    return Object.values(ical.sync.parseICS(ics))
      .filter((component): component is VEvent => component?.type === 'VEVENT');
  }

  /** The first VEVENT of an event; every UID the export writes starts with the event id. */
  function veventOf(vevents: VEvent[], eventId: string): VEvent {
    const found = vevents.find(vevent => vevent.uid.slice(0, 36) === eventId);
    if (!found) {
      throw new Error(`no VEVENT for ${eventId}`);
    }
    return found;
  }

  /** node-ical gives a TEXT value as a string, or as { val } when it has parameters. */
  function text(value: unknown): string {
    if (typeof value === 'string') return value;
    return (value as { val?: string } | undefined)?.val ?? '';
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
    calendarInterface = new CalendarInterface(new EventEmitter());

    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(
      new EventEmitter(),
      configurationInterface,
      new SetupInterface(configurationInterface),
      new EmailInterface(),
    );
    const { account: owner } = await accountService._setupAccount('export-owner@pavillion.dev', 'testpassword');
    ownerAccountId = owner.id;
    ownerToken = await env.login('export-owner@pavillion.dev', 'testpassword');
    await accountService._setupAccount('export-other@pavillion.dev', 'testpassword');
    otherToken = await env.login('export-other@pavillion.dev', 'testpassword');
    const { account: editor } = await accountService._setupAccount('export-editor@pavillion.dev', 'testpassword');
    editorToken = await env.login('export-editor@pavillion.dev', 'testpassword');
    await env.createAdminAccount('export-admin@pavillion.dev', 'testpassword');
    adminToken = await env.login('export-admin@pavillion.dev', 'testpassword');

    mainCalendar = await createCalendar(ownerToken, 'exportmain', {
      en: { name: 'Export Main' },
      fr: { name: 'Calendrier principal' },
    });
    emptyCalendar = await createCalendar(ownerToken, 'exportempty');
    brokenCalendar = await createCalendar(ownerToken, 'exportbroken');
    orderCalendar = await createCalendar(ownerToken, 'exportorder', { fr: { name: 'Ordre du jour' } });
    const otherCalendar = await createCalendar(otherToken, 'exportother');

    await CalendarMemberEntity.create({
      id: uuidv4(),
      calendar_id: mainCalendar.id,
      account_id: editor.id,
      role: 'editor',
      granted_by: owner.id,
    });

    // Weekly at 18:00 in New York, twelve weeks back to seven weeks ahead
    const weeklyStart = todayIn(NEW_YORK, 18).minus({ weeks: 12 });
    weeklyId = await createEvent(ownerToken, {
      calendarId: mainCalendar.id,
      content: {
        en: { name: 'Monday Supper', description: 'Bring a dish to share.' },
        es: { name: 'Cena del lunes', description: 'Trae un plato para compartir.' },
      },
      schedules: [schedule(weeklyStart, { frequency: 'weekly', interval: 1, count: 20 })],
    });
    await settle(weeklyId, weeklyStart.plus({ weeks: 19 }));
    hiddenDate = weeklyStart.plus({ weeks: 14 });
    shownCancelledDate = weeklyStart.plus({ weeks: 15 });
    await cancelDate(weeklyId, hiddenDate, true);
    await cancelDate(weeklyId, shownCancelledDate, false);

    // Weekly at 10:00 for eight weeks, plus one extra date at 15:00
    const seriesStart = todayIn(NEW_YORK, 10).minus({ weeks: 4 });
    extraDate = todayIn(NEW_YORK, 15).plus({ days: 2 });
    seriesPlusExtraId = await createEvent(ownerToken, {
      calendarId: mainCalendar.id,
      content: { en: { name: 'Garden Work Day' } },
      schedules: [
        schedule(seriesStart, { frequency: 'weekly', interval: 1, count: 8 }),
        schedule(extraDate),
      ],
    });
    await settle(seriesPlusExtraId, seriesStart.plus({ weeks: 7 }));

    // Weekly at 19:30 in Berlin, six weeks back to three weeks ahead
    const berlinStart = todayIn(BERLIN, 19, 30).minus({ weeks: 6 });
    berlinId = await createEvent(ownerToken, {
      calendarId: mainCalendar.id,
      content: { en: { name: 'Stammtisch' } },
      schedules: [schedule(berlinStart, { frequency: 'weekly', interval: 1, count: 10 })],
    });
    await settle(berlinId, berlinStart.plus({ weeks: 9 }));

    const singleStart = todayIn(NEW_YORK, 12).plus({ days: 10 });
    singleId = await createEvent(ownerToken, {
      calendarId: mainCalendar.id,
      content: { en: { name: 'Town Meeting', description: 'The agenda is posted at the door.' } },
      location: { name: 'Town Hall', address: '1 Main St', city: 'Springfield', state: '', postalCode: '' },
      schedules: [schedule(singleStart)],
    });
    await settle(singleId, singleStart);

    const multilingualStart = todayIn(NEW_YORK, 19).plus({ days: 5 });
    multilingualId = await createEvent(ownerToken, {
      calendarId: mainCalendar.id,
      content: {
        en: { name: 'Evening Concert', description: 'An evening of music.', accessibilityInfo: 'Step-free entrance.' },
        es: { name: 'Concierto', description: 'Una noche de música.', accessibilityInfo: 'Entrada sin escalones.' },
        fr: { name: 'Concert du soir', description: 'Une soirée de musique.', accessibilityInfo: 'Entrée de plain-pied.' },
      },
      schedules: [schedule(multilingualStart)],
    });
    await settle(multilingualId, multilingualStart);

    // The main calendar's own category on the single event, and another
    // calendar's category on the same event, as a reposting calendar's would be
    const ownCategory = await request(env.app)
      .post(`/api/v1/calendars/${mainCalendar.id}/categories`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ content: { en: { name: 'Civic' }, es: { name: 'Cívico' } } });
    expect(ownCategory.status).toBe(201);
    const assigned = await request(env.app)
      .post(`/api/v1/events/${singleId}/categories/${ownCategory.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(assigned.status).toBeLessThan(300);
    const foreignCategory = await request(env.app)
      .post(`/api/v1/calendars/${otherCalendar.id}/categories`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ content: { en: { name: 'Foreign Tag' } } });
    expect(foreignCategory.status).toBe(201);
    await EventCategoryAssignmentEntity.create({ event_id: singleId, category_id: foreignCategory.body.id });

    // Another calendar's event, reposted by the main calendar
    const repostedStart = todayIn(NEW_YORK, 12).plus({ days: 4 });
    repostedId = await createEvent(otherToken, {
      calendarId: otherCalendar.id,
      content: { en: { name: 'Elsewhere Fair' } },
      schedules: [schedule(repostedStart)],
    });
    await settle(repostedId, repostedStart);
    await EventRepostEntity.create({ id: uuidv4(), event_id: repostedId, calendar_id: mainCalendar.id });

    // The order calendar's oldest content row must sort after a newer one:
    // creating over HTTP always writes an en row first, so drop it and add en
    // back after fr.
    for (const content of [{ en: null }, { en: { name: 'Order of the day' } }]) {
      const patched = await request(env.app)
        .patch(`/api/v1/calendars/${orderCalendar.id}/settings`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content });
      expect(patched.status).toBeLessThan(300);
    }
    const orderEventStart = todayIn(NEW_YORK, 12).plus({ days: 6 });
    const orderEventId = await createEvent(ownerToken, {
      calendarId: orderCalendar.id,
      content: { es: { name: 'Orden del día' } },
      schedules: [schedule(orderEventStart)],
    });
    await settle(orderEventId, orderEventStart);

    const brokenStart = todayIn(NEW_YORK, 12).plus({ days: 3 });
    brokenEventId = await createEvent(ownerToken, {
      calendarId: brokenCalendar.id,
      content: { en: { name: 'Broken Schedule Social' } },
      schedules: [schedule(brokenStart)],
    });
    await settle(brokenEventId, brokenStart);
    await EventScheduleEntity.update({ timezone: 'Not/AZone' }, { where: { event_id: brokenEventId } });
  }, 120_000);

  afterAll(async () => {
    if (env) {
      // Queue behind any write still pending on the FIFO SQLite connection
      await EventInstanceEntity.count();
      await env.cleanup();
    }
  });

  describe('occurrence round trip', () => {
    let vevents: VEvent[];
    let instances: Array<{ eventId: string; instance: EventInstance }>;
    const key = (eventId: string, ms: number) => `${eventId} ${new Date(ms).toISOString()}`;

    beforeAll(async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=en');
      expect(response.status).toBe(200);
      vevents = parseVevents(response.text);
      instances = vevents.flatMap(vevent => ical
        .expandRecurringEvent(vevent, { from: windowStart.toJSDate(), to: windowEnd.toJSDate() })
        .map(instance => ({ eventId: vevent.uid.slice(0, 36), instance })));
    });

    it('holds every occurrence Pavillion lists in the window, at the same instant, and no other', async () => {
      const expected: string[] = [];
      for (const eventId of [weeklyId, seriesPlusExtraId, berlinId, singleId, multilingualId]) {
        const event = await calendarInterface.getEventById(eventId);
        const { occurrences, hasMore } = await calendarInterface.listUpcomingOccurrences(event, windowStart, 1000);
        expect(hasMore).toBe(false);
        expected.push(...occurrences
          .filter(occurrence => occurrence.state !== 'hidden' && occurrence.start.toMillis() <= windowEnd.toMillis())
          .map(occurrence => key(eventId, occurrence.start.toMillis())));
      }
      const actual = instances.map(({ eventId, instance }) => key(eventId, instance.start.getTime()));

      expect(actual.sort()).toEqual(expected.sort());
      // 20 weekly, less the hidden one; 8 + 1 extra; 10 in Berlin; two single dates
      expect(expected).toHaveLength(19 + 9 + 10 + 2);
      expect(expected).toContain(key(seriesPlusExtraId, extraDate.toMillis()));
    });

    it('leaves the hidden date out', () => {
      const starts = instances
        .filter(({ eventId }) => eventId === weeklyId)
        .map(({ instance }) => instance.start.getTime());

      expect(starts).not.toContain(hiddenDate.toMillis());
      expect(starts).toContain(hiddenDate.plus({ weeks: 1 }).toMillis());
    });

    it('marks the date shown as cancelled, and only that date, CANCELLED', () => {
      const cancelled = instances.filter(({ instance }) => instance.event.status === 'CANCELLED');

      expect(cancelled.map(({ eventId, instance }) => key(eventId, instance.start.getTime())))
        .toEqual([key(weeklyId, shownCancelledDate.toMillis())]);
    });

    it('carries the place and only the calendar\'s own categories', () => {
      const single = veventOf(vevents, singleId);

      expect(text(single.location)).toBe('Town Hall, 1 Main St, Springfield');
      expect(single.categories).toEqual(['Civic']);
    });

    it('holds the calendar\'s own events only, not the event it reposts', () => {
      const eventIds = new Set(vevents.map(vevent => vevent.uid.slice(0, 36)));

      expect(eventIds).toEqual(new Set([weeklyId, seriesPlusExtraId, berlinId, singleId, multilingualId]));
      expect(eventIds).not.toContain(repostedId);
    });
  });

  describe('language', () => {
    it('gives the second language\'s summary and description', async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=es');

      expect(response.status).toBe(200);
      const weekly = veventOf(parseVevents(response.text), weeklyId);
      expect(text(weekly.summary)).toBe('Cena del lunes');
      expect(text(weekly.description)).toBe('Trae un plato para compartir.');
    });

    it('falls back to the first language for an event with no content in the second', async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=es');

      const single = veventOf(parseVevents(response.text), singleId);
      expect(text(single.summary)).toBe('Town Meeting');
      expect(text(single.description)).toBe('The agenda is posted at the door.');
    });

    it.each([
      ['en', 'Evening Concert', 'Accessibility', 'Step-free entrance.'],
      ['es', 'Concierto', 'Accesibilidad', 'Entrada sin escalones.'],
      ['fr', 'Concert du soir', 'Accessibilité', 'Entrée de plain-pied.'],
    ])('puts the accessibility notes under a translated heading in %s', async (lang, summary, heading, notes) => {
      const response = await exportFile(ownerToken, mainCalendar.id, `?lang=${lang}`);

      expect(response.status).toBe(200);
      const concert = veventOf(parseVevents(response.text), multilingualId);
      expect(text(concert.summary)).toBe(summary);
      expect(text(concert.description)).toContain(`${heading}:\n${notes}`);
    });

    it('translates category names into the export language', async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=es');

      expect(veventOf(parseVevents(response.text), singleId).categories).toEqual(['Cívico']);
    });
  });

  describe('export languages', () => {
    it('lists the calendar\'s content languages, then the events\' others, the same way every time', async () => {
      const first = await exportLanguages(ownerToken, mainCalendar.id);
      const second = await exportLanguages(ownerToken, mainCalendar.id);

      expect(first.status).toBe(200);
      // en and fr are the calendar's own, oldest first; es comes only from events
      expect(first.body).toEqual({ languages: ['en', 'fr', 'es'] });
      expect(second.body).toEqual(first.body);
    });

    it('orders the calendar\'s content languages by when they were added, not by code', async () => {
      const response = await exportLanguages(ownerToken, orderCalendar.id);

      expect(response.body).toEqual({ languages: ['fr', 'en', 'es'] });
    });

    it('lists the calendar\'s own language for a calendar with no events', async () => {
      const response = await exportLanguages(ownerToken, emptyCalendar.id);

      expect(response.body).toEqual({ languages: ['en'] });
    });

    it.each([
      ['a language no event or calendar uses', '?lang=de'],
      ['a missing language', ''],
      ['a repeated language', '?lang=en&lang=es'],
    ])('refuses %s with 400 rather than defaulting', async (_label, query) => {
      const response = await exportFile(ownerToken, mainCalendar.id, query);

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ValidationError');
      expect(response.headers['content-disposition']).toBeUndefined();
    });
  });

  describe('access', () => {
    const routes: Array<[string, (token: string | null, calendarId: string) => request.Test]> = [
      ['export', (token, calendarId) => exportFile(token, calendarId, '?lang=en')],
      ['export languages', exportLanguages],
    ];

    it.each(routes)('%s: refuses an anonymous request with 401', async (_name, call) => {
      const response = await call(null, mainCalendar.id);

      expect(response.status).toBe(401);
    });

    it.each(routes)('%s: refuses a signed-in account that does not own the calendar with 403', async (_name, call) => {
      for (const token of [otherToken, editorToken, adminToken]) {
        const response = await call(token, mainCalendar.id);

        expect(response.status).toBe(403);
        expect(response.body).toEqual({ error: 'Permission denied', errorName: 'CalendarEditorPermissionError' });
      }
    });

    it.each(routes)('%s: answers 400 for a calendar id that is not a UUID', async (_name, call) => {
      const response = await call(ownerToken, 'not-a-uuid');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'invalid calendarId format', errorName: 'ValidationError' });
    });

    it.each(routes)('%s: answers 404 for an unknown calendar', async (_name, call) => {
      const response = await call(ownerToken, uuidv4());

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Calendar not found', errorName: 'CalendarNotFoundError' });
    });

    it('sends the owner the file as a named calendar attachment', async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=fr');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(`attachment; filename="${mainCalendar.urlName}-fr.ics"`);
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('privacy', () => {
    it('puts neither the owner\'s email nor their account id in the file or its headers', async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=en');
      const sent = `${JSON.stringify(response.headers)}\n${response.text}`;

      expect(response.status).toBe(200);
      expect(sent).not.toContain('export-owner@pavillion.dev');
      expect(sent).not.toContain(ownerAccountId);
    });
  });

  describe('no silent failures', () => {
    it('counts the events the file holds in a header', async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=en');
      const eventIds = new Set(parseVevents(response.text).map(vevent => vevent.uid.slice(0, 36)));

      expect(response.headers['x-pavillion-event-count']).toBe(String(eventIds.size));
      expect(eventIds.size).toBe(5);
    });

    it('sends a calendar with no events a valid file with none, and says so', async () => {
      const response = await exportFile(ownerToken, emptyCalendar.id, '?lang=en');

      expect(response.status).toBe(200);
      expect(response.headers['x-pavillion-event-count']).toBe('0');
      expect(response.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
      expect(response.text.endsWith('END:VCALENDAR\r\n')).toBe(true);
      expect(response.text).not.toContain('BEGIN:VEVENT');
      expect(() => ical.sync.parseICS(response.text)).not.toThrow();
    });

    it('fails the whole request, naming nothing, when one event cannot be written', async () => {
      const response = await exportFile(ownerToken, brokenCalendar.id, '?lang=en');

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Calendar export failed', errorName: 'CalendarExportError' });
      expect(response.headers['content-disposition']).toBeUndefined();
      for (const secret of [brokenEventId, brokenCalendar.id, 'Broken Schedule Social', 'Not/AZone', 'BEGIN:VCALENDAR']) {
        expect(response.text).not.toContain(secret);
      }
    });
  });

  describe('valid iCalendar', () => {
    let ics: string;

    beforeAll(async () => {
      const response = await exportFile(ownerToken, mainCalendar.id, '?lang=fr');
      expect(response.status).toBe(200);
      ics = response.text;
    });

    /** Physical lines, without their CRLF. */
    const physicalLines = () => ics.slice(0, -2).split('\r\n');

    /** Logical lines: continuation lines joined back onto the line they fold. */
    function unfoldedLines(): string[] {
      const lines: string[] = [];
      for (const line of physicalLines()) {
        if (line.startsWith(' ') || line.startsWith('\t')) {
          lines[lines.length - 1] += line.slice(1);
        }
        else {
          lines.push(line);
        }
      }
      return lines;
    }

    interface Component { name: string; properties: string[]; children: Component[] }

    function componentTree(): Component {
      const root: Component = { name: '', properties: [], children: [] };
      const stack = [root];
      for (const line of unfoldedLines()) {
        const name = line.split(/[;:]/, 1)[0];
        const value = line.slice(line.indexOf(':') + 1);
        if (name === 'BEGIN') {
          const component: Component = { name: value, properties: [], children: [] };
          stack[stack.length - 1].children.push(component);
          stack.push(component);
        }
        else if (name === 'END') {
          expect(stack.pop()?.name).toBe(value);
        }
        else {
          stack[stack.length - 1].properties.push(name);
        }
      }
      expect(stack).toHaveLength(1);
      expect(root.children).toHaveLength(1);
      return root.children[0];
    }

    it('ends every line with CRLF and has no bare CR or LF', () => {
      expect(ics.endsWith('\r\n')).toBe(true);
      for (const line of physicalLines()) {
        expect(line).not.toMatch(/[\r\n]/);
      }
    });

    it('has no physical line longer than 75 octets', () => {
      for (const line of physicalLines()) {
        expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
      }
    });

    it('writes every content line as name, parameters and value', () => {
      const param = '[A-Za-z0-9-]+=(?:"[^"]*"|[^";:,]*)(?:,(?:"[^"]*"|[^";:,]*))*';
      const contentLine = new RegExp(`^[A-Za-z0-9-]+(?:;${param})*:`);
      for (const line of unfoldedLines()) {
        expect(line).toMatch(contentLine);
      }
    });

    it('balances BEGIN and END, with VERSION and PRODID on the calendar', () => {
      const calendar = componentTree();

      expect(calendar.name).toBe('VCALENDAR');
      expect(calendar.properties).toContain('VERSION');
      expect(calendar.properties).toContain('PRODID');
    });

    it('gives each VEVENT exactly one UID, DTSTAMP and DTSTART', () => {
      const vevents = componentTree().children.filter(child => child.name === 'VEVENT');

      expect(vevents.length).toBeGreaterThan(5);
      for (const vevent of vevents) {
        for (const property of ['UID', 'DTSTAMP', 'DTSTART']) {
          expect(vevent.properties.filter(name => name === property)).toHaveLength(1);
        }
      }
    });

    it('gives each VTIMEZONE a TZID and observances with their onset and offsets', () => {
      const vtimezones = componentTree().children.filter(child => child.name === 'VTIMEZONE');

      expect(vtimezones.length).toBeGreaterThanOrEqual(2);
      for (const vtimezone of vtimezones) {
        expect(vtimezone.properties).toContain('TZID');
        const observances = vtimezone.children.filter(child => child.name === 'STANDARD' || child.name === 'DAYLIGHT');
        expect(observances.length).toBeGreaterThan(0);
        for (const observance of observances) {
          expect(observance.properties).toEqual(expect.arrayContaining(['DTSTART', 'TZOFFSETFROM', 'TZOFFSETTO']));
        }
      }
    });

    it('declares a VTIMEZONE for every TZID it uses', () => {
      const lines = unfoldedLines();
      const declared = new Set(lines.filter(line => line.startsWith('TZID:')).map(line => line.slice('TZID:'.length)));
      const used = new Set(lines.flatMap(line => [...line.matchAll(/;TZID=([^;:]+)/g)].map(match => match[1])));

      expect(used).toEqual(new Set([NEW_YORK, BERLIN]));
      for (const zone of used) {
        expect(declared).toContain(zone);
      }
    });

    it('is read by node-ical', () => {
      expect(() => ical.sync.parseICS(ics)).not.toThrow();
      expect(parseVevents(ics).length).toBeGreaterThanOrEqual(5);
    });

    it('gives the same UIDs on a second export', async () => {
      const uids = (file: string) => file
        .replace(/\r\n[ \t]/g, '')
        .split('\r\n')
        .filter(line => line.startsWith('UID:'))
        .sort();
      const again = await exportFile(ownerToken, mainCalendar.id, '?lang=fr');

      expect(uids(again.text)).toEqual(uids(ics));
      expect(uids(ics).length).toBeGreaterThan(5);
    });
  });
});
