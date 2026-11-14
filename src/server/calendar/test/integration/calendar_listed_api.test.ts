import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import AccountService from '@/server/accounts/service/account';
import AccountsInterface from '@/server/accounts/interface';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * The owner's control over whether a calendar appears on the instance's public
 * calendar list (/discover), driven through the real settings route.
 *
 * Unlisting takes the calendar off that one list. Its own public page stays
 * reachable without login, which these tests check alongside the list.
 */
describe('Calendar listed setting — HTTP API (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let eventBus: EventEmitter;
  let owner: Account;
  let calendar: Calendar;
  let ownerKey: string;
  let editorKey: string;
  let adminKey: string;

  const password = 'testpassword';

  const patchSettings = (authKey: string | null, body: Record<string, unknown>) => {
    const req = request(env.app).patch(`/api/v1/calendars/${calendar.id}/settings`);
    if (authKey) {
      req.set('Authorization', 'Bearer ' + authKey);
    }
    return req.send(body);
  };

  const storedListed = async (): Promise<boolean> => {
    const entity = await CalendarEntity.findByPk(calendar.id);
    return entity!.listed;
  };

  const publicListUrlNames = async (): Promise<string[]> => {
    const response = await request(env.app).get('/api/public/v1/calendars');
    expect(response.status).toBe(200);
    return response.body.map((row: { urlName: string }) => row.urlName);
  };

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    owner = (await accountService._setupAccount('listed-owner@pavillion.dev', password)).account;
    await accountService._setupAccount('listed-editor@pavillion.dev', password);
    await env.createAdminAccount('listed-admin@pavillion.dev', password);

    calendar = await calendarInterface.createCalendar(owner, 'listedcalendar');
    await calendarInterface.grantEditAccessByEmail(owner, calendar.id, 'listed-editor@pavillion.dev');

    ownerKey = await env.login('listed-owner@pavillion.dev', password);
    editorKey = await env.login('listed-editor@pavillion.dev', password);
    adminKey = await env.login('listed-admin@pavillion.dev', password);
  });

  afterAll(async () => {
    eventBus?.removeAllListeners();
    await env.cleanup();
  });

  it('lists a new calendar by default', async () => {
    expect(calendar.listed).toBe(true);
    expect(await publicListUrlNames()).toContain('listedcalendar');
  });

  it('lets the owner unlist the calendar, which leaves the list but keeps its public page', async () => {
    const response = await patchSettings(ownerKey, { listed: false });
    expect(response.status).toBe(200);
    expect(response.body.listed).toBe(false);

    // Survives a reload: the owner's calendar list reads it back.
    const mine = await env.authGet(ownerKey, '/api/v1/calendars');
    expect(mine.body.find((c: { id: string }) => c.id === calendar.id).listed).toBe(false);

    expect(await publicListUrlNames()).not.toContain('listedcalendar');

    const page = await request(env.app).get('/api/public/v1/calendar/listedcalendar');
    expect(page.status).toBe(200);
  });

  it('lets the owner list it again', async () => {
    const response = await patchSettings(ownerKey, { listed: true });
    expect(response.status).toBe(200);
    expect(await storedListed()).toBe(true);
    expect(await publicListUrlNames()).toContain('listedcalendar');
  });

  it('lets an admin change it on a calendar they do not own', async () => {
    const response = await patchSettings(adminKey, { listed: false });
    expect(response.status).toBe(200);
    expect(await storedListed()).toBe(false);

    await patchSettings(adminKey, { listed: true });
    expect(await storedListed()).toBe(true);
  });

  it('refuses an editor who is not the owner with 403 and leaves the value alone', async () => {
    const response = await patchSettings(editorKey, { listed: false });
    expect(response.status).toBe(403);
    expect(response.body.errorName).toBe('CalendarEditorPermissionError');
    expect(await storedListed()).toBe(true);
  });

  it('refuses an anonymous request with 401', async () => {
    const response = await patchSettings(null, { listed: false });
    expect(response.status).toBe(401);
    expect(await storedListed()).toBe(true);
  });

  it('rejects a listed value that is not a boolean with 400', async () => {
    // "false" is truthy; coercing it would keep listing a calendar the owner
    // asked to take off the list.
    const response = await patchSettings(ownerKey, { listed: 'false' });
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(await storedListed()).toBe(true);
  });

  it('leaves listed unchanged when a settings save does not carry it', async () => {
    await patchSettings(ownerKey, { listed: false });

    const response = await patchSettings(ownerKey, { defaultDateRange: '1month' });
    expect(response.status).toBe(200);
    expect(await storedListed()).toBe(false);

    await patchSettings(ownerKey, { listed: true });
  });
});
