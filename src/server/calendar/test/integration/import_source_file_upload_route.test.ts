import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventScheduleEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import { ImportRunEntity } from '@/server/calendar/entity/import_run';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import db from '@/server/common/entity/db';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import createImportRun from '../../../../../migrations/0027_create_import_run';

const FIXTURE_PATH = path.join(process.cwd(), 'tests/e2e/fixtures/ics/with-rrule.ics');

/**
 * Route-level integration test for `POST /api/v1/calendars/:id/import-sources/file`.
 *
 * The harness builds its schema with `db.sync()`, but staging and production
 * build theirs from the migrations, and the two disagreed on
 * `import_run.created_at`: the migration declares it NOT NULL with no database
 * default, while the entity never wrote it. `beforeAll` therefore rebuilds
 * `import_run` from its migration so the upload runs against the schema a
 * deployed instance actually has.
 */
describe('POST /import-sources/file', () => {
  let env: TestEnvironment;
  let eventBus: EventEmitter;
  let calendar: Calendar;
  let calendarInterface: CalendarInterface;
  let account: Account;
  let token: string;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    await ImportRunEntity.drop();
    await createImportRun.up({ context: db });

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const accountService = new AccountService(eventBus, new ConfigurationInterface(), new SetupInterface());

    const email = 'fileroute@pavillion.dev';
    const password = 'testpassword';
    ({ account } = await accountService._setupAccount(email, password));
    calendar = await calendarInterface.createCalendar(account, 'fileroutecal');
    token = await env.login(email, password);
  });

  afterAll(async () => {
    eventBus?.removeAllListeners();
    await env.cleanup();
  });

  it('creates the source, records the run and imports the events', async () => {
    const response = await request(env.app)
      .post(`/api/v1/calendars/${calendar.id}/import-sources/file`)
      .set('Authorization', 'Bearer ' + token)
      .attach('file', fs.readFileSync(FIXTURE_PATH), {
        filename: 'with-rrule.ics',
        contentType: 'text/calendar',
      });

    expect(response.status).toBe(201);
    expect(response.body.run).toMatchObject({ outcome: 'success', eventsCreated: 1 });

    const source = await ImportSourceEntity.findByPk(response.body.source.id);
    expect(source).not.toBeNull();
    expect(source!.calendar_id).toBe(calendar.id);
    expect(source!.source_type).toBe('file');
    expect(source!.original_filename).toBe('with-rrule.ics');

    const run = await ImportRunEntity.findByPk(response.body.run.id);
    expect(run).not.toBeNull();
    expect(run!.import_source_id).toBe(source!.id);
    expect(run!.outcome).toBe('success');
    expect(run!.events_created).toBe(1);
    expect(run!.created_at).toBeInstanceOf(Date);

    const origin = await EventImportOriginEntity.findOne({
      where: { import_source_id: source!.id, external_uid: 'e2e-rrule-daily@import-sources.test' },
    });
    expect(origin).not.toBeNull();
    const event = await EventEntity.findByPk(origin!.event_id);
    expect(event).not.toBeNull();
    expect(event!.calendar_id).toBe(calendar.id);
  });

  it('accepts the same file a second time and updates the existing event', async () => {
    const secondCalendar = await calendarInterface.createCalendar(account, 'filereuploadcal');
    const upload = () => request(env.app)
      .post(`/api/v1/calendars/${secondCalendar.id}/import-sources/file`)
      .set('Authorization', 'Bearer ' + token)
      .attach('file', fs.readFileSync(FIXTURE_PATH), {
        filename: 'with-rrule.ics',
        contentType: 'text/calendar',
      });

    const first = await upload();
    expect(first.status).toBe(201);
    expect(first.body.run).toMatchObject({ outcome: 'success', eventsCreated: 1 });

    const second = await upload();
    expect(second.status).toBe(201);
    expect(second.body.run).toMatchObject({ outcome: 'success', eventsCreated: 0, eventsUpdated: 1 });

    expect(await EventEntity.count({ where: { calendar_id: secondCalendar.id } })).toBe(1);

    const origin = await EventImportOriginEntity.findOne({
      where: { external_uid: 'e2e-rrule-daily@import-sources.test', import_source_id: second.body.source.id },
    });
    expect(origin).not.toBeNull();
    const event = await EventEntity.findByPk(origin!.event_id);
    expect(event!.calendar_id).toBe(secondCalendar.id);

    const schedules = await EventScheduleEntity.findAll({
      where: { event_id: origin!.event_id, is_exclusion: false },
    });
    expect(schedules).toHaveLength(1);
  });
});
