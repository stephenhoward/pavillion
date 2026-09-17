import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for event content imageAlt over the HTTP API.
 *
 * event_image_alt.test.ts already covers the write paths through
 * CalendarInterface. This file exists because the bug class it guards against
 * lives above that seam: imageAlt is REPLACE-on-update (both validators map a
 * nullish value to ''), while the adjacent name and description are PATCH
 * (Sequelize drops undefined from an update). An editor that sends only the
 * fields the author touched therefore deletes alt text with no error and no
 * failing interface-level test — the request body is the only place that
 * divergence is visible.
 *
 * So these tests drive the real express handler with the real request body,
 * and assert what a full-model save (which is what the event editor sends)
 * does to stored alt text.
 */
describe('Event content imageAlt — HTTP API round-trip (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;
  let authKey: string;

  const userEmail = 'imagealtapi@pavillion.dev';
  const userPassword = 'testpassword';

  /**
   * Fetches an event's stored content straight from the API.
   *
   * @param {string} eventId - The event to read back
   * @returns {Promise<Record<string, any>>} The content map keyed by language
   */
  const fetchContent = async (eventId: string): Promise<Record<string, any>> => {
    const response = await env.authGet(authKey, `/api/v1/events/${eventId}`);
    expect(response.status).toBe(200);
    return response.body.content;
  };

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount(userEmail, userPassword);
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'imagealtapicalendar');

    authKey = await env.login(userEmail, userPassword);
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  /**
   * Creates an event over the API with alt text in English and French.
   *
   * @param {string} startDate - The event's start date
   * @returns {Promise<string>} The created event's id
   */
  const createIllustratedEvent = async (startDate: string): Promise<string> => {
    const response = await env.authPost(authKey, '/api/v1/events', {
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Lantern Festival', description: 'Lights in the park', imageAlt: 'Paper lanterns over a path' },
        fr: { name: 'Fête des lanternes', description: 'Lumières au parc', imageAlt: 'Des lanternes en papier' },
      },
      start_date: startDate,
    });

    expect(response.status).toBe(201);
    return response.body.id;
  };

  it('persists imageAlt for every language sent on create', async () => {
    const eventId = await createIllustratedEvent('2026-07-01');

    const content = await fetchContent(eventId);
    expect(content.en.imageAlt).toBe('Paper lanterns over a path');
    expect(content.fr.imageAlt).toBe('Des lanternes en papier');
  });

  it('keeps alt text in every language when a full-model update changes only the title', async () => {
    const eventId = await createIllustratedEvent('2026-07-02');

    // What the event editor sends: the whole working model, every language,
    // with only the title actually edited.
    const response = await env.authPut(authKey, `/api/v1/events/${eventId}`, {
      id: eventId,
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Lantern Festival 2026', description: 'Lights in the park', imageAlt: 'Paper lanterns over a path' },
        fr: { name: 'Fête des lanternes', description: 'Lumières au parc', imageAlt: 'Des lanternes en papier' },
      },
    });
    expect(response.status).toBe(200);

    const content = await fetchContent(eventId);
    expect(content.en.name).toBe('Lantern Festival 2026');
    expect(content.en.imageAlt).toBe('Paper lanterns over a path');
    expect(content.fr.imageAlt).toBe('Des lanternes en papier');
  });

  it('clears alt text in a language whose update omits imageAlt, while keeping its name', async () => {
    const eventId = await createIllustratedEvent('2026-07-03');

    // The failure mode the editor must never produce: a title-only payload.
    // name survives because it is patch-semantics; imageAlt does not, because
    // it is replace-semantics. This asymmetry is the whole reason the editor
    // sends imageAlt for every language on every content save.
    const response = await env.authPut(authKey, `/api/v1/events/${eventId}`, {
      id: eventId,
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Lantern Festival 2026' },
        fr: { name: 'Fête des lanternes' },
      },
    });
    expect(response.status).toBe(200);

    const content = await fetchContent(eventId);
    expect(content.en.name).toBe('Lantern Festival 2026');
    expect(content.fr.name).toBe('Fête des lanternes');
    expect(content.en.imageAlt).toBe('');
    expect(content.fr.imageAlt).toBe('');
  });

  it('clears alt text in every language when the author marks the image decorative', async () => {
    const eventId = await createIllustratedEvent('2026-07-04');

    // Decorative is not a stored flag — it is an explicit empty alt text in
    // every language, which is exactly what the editor sends.
    const response = await env.authPut(authKey, `/api/v1/events/${eventId}`, {
      id: eventId,
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Lantern Festival', description: 'Lights in the park', imageAlt: '' },
        fr: { name: 'Fête des lanternes', description: 'Lumières au parc', imageAlt: '' },
      },
    });
    expect(response.status).toBe(200);

    const content = await fetchContent(eventId);
    expect(content.en.imageAlt).toBe('');
    expect(content.fr.imageAlt).toBe('');
    expect(content.en.description).toBe('Lights in the park');
  });

  it('restores alt text on a later update after it was cleared', async () => {
    const eventId = await createIllustratedEvent('2026-07-05');

    await env.authPut(authKey, `/api/v1/events/${eventId}`, {
      id: eventId,
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Lantern Festival', imageAlt: '' },
        fr: { name: 'Fête des lanternes', imageAlt: '' },
      },
    });

    const response = await env.authPut(authKey, `/api/v1/events/${eventId}`, {
      id: eventId,
      calendarId: testCalendar.id,
      content: {
        en: { name: 'Lantern Festival', imageAlt: 'Paper lanterns over a path' },
        fr: { name: 'Fête des lanternes', imageAlt: 'Des lanternes en papier' },
      },
    });
    expect(response.status).toBe(200);

    const content = await fetchContent(eventId);
    expect(content.en.imageAlt).toBe('Paper lanterns over a path');
    expect(content.fr.imageAlt).toBe('Des lanternes en papier');
  });
});
