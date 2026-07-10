import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventImportOriginEntity } from '@/server/calendar/entity/event_import_origin';
import { ImportSourceEntity } from '@/server/calendar/entity/import_source';
import CalendarInterface from '@/server/calendar/interface';
import { ImportSourceParseError } from '@/common/exceptions/import';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Real-DB integration tests for the file-upload import path (pv-84da.1.4 +
 * fix round). Exercises `createSourceFromFile` end-to-end through the interface
 * against a real SQLite database (real node-ical parse, real EventService,
 * real transaction), so the transactional rollback and the calendar-wide dedup
 * scoping are verified against actual persistence rather than stubs.
 */
describe('ImportSource file upload integration', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let account: Account;
  let calendarA: Calendar;
  let calendarB: Calendar;
  let eventBus: EventEmitter;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
    } as never);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const accountInfo = await accountService._setupAccount('fileupload@pavillion.dev', 'testpassword');
    account = accountInfo.account;
    calendarA = await calendarInterface.createCalendar(account, 'fileuploadcala');
    calendarB = await calendarInterface.createCalendar(account, 'fileuploadcalb');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  /** Build a minimal single-VEVENT ICS body for the given uid + summary. */
  function icsWith(uid: string, summary: string): Buffer {
    return Buffer.from(
      'BEGIN:VCALENDAR\r\n'
      + 'VERSION:2.0\r\n'
      + 'PRODID:-//pavillion//test//EN\r\n'
      + 'BEGIN:VEVENT\r\n'
      + `UID:${uid}\r\n`
      + 'DTSTAMP:20260422T100000Z\r\n'
      + 'DTSTART:20260422T100000Z\r\n'
      + 'DTEND:20260422T110000Z\r\n'
      + `SUMMARY:${summary}\r\n`
      + 'END:VEVENT\r\n'
      + 'END:VCALENDAR\r\n',
    );
  }

  // --------------------------------------------------------------------------
  // Rollback leaves no orphan source row
  // --------------------------------------------------------------------------

  describe('transactional rollback', () => {
    it('leaves no orphan source row when the upload yields zero usable VEVENTs', async () => {
      const sourcesBefore = await ImportSourceEntity.count({ where: { calendar_id: calendarA.id } });
      const eventsBefore = await EventEntity.count({ where: { calendar_id: calendarA.id } });

      // Valid VCALENDAR (passes the BEGIN:VCALENDAR sniff and parses) but with
      // no VEVENTs — createSourceFromFile must throw 422 and roll the source
      // row insert back so no orphan source is left behind.
      const emptyCalendar = Buffer.from(
        'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//pavillion//test//EN\r\nEND:VCALENDAR\r\n',
      );

      await expect(
        calendarInterface.createImportSourceFromFile(account, calendarA.id, emptyCalendar, 'empty.ics'),
      ).rejects.toBeInstanceOf(ImportSourceParseError);

      const sourcesAfter = await ImportSourceEntity.count({ where: { calendar_id: calendarA.id } });
      const eventsAfter = await EventEntity.count({ where: { calendar_id: calendarA.id } });

      // Rollback is atomic: no source row, no event rows added.
      expect(sourcesAfter).toBe(sourcesBefore);
      expect(eventsAfter).toBe(eventsBefore);
    });
  });

  // --------------------------------------------------------------------------
  // Cross-calendar dedup isolation (gap carried from pv-84da.1.3)
  // --------------------------------------------------------------------------

  describe('cross-calendar dedup isolation', () => {
    it('does not touch another calendar\'s event or origin sharing the same external_uid', async () => {
      const SHARED_UID = 'shared-uid@example.test';

      // Seed calendar B with an imported event carrying SHARED_UID.
      const bResult = await calendarInterface.createImportSourceFromFile(
        account,
        calendarB.id,
        icsWith(SHARED_UID, 'Calendar B Event'),
        'b.ics',
      );
      expect(bResult.run.eventsCreated).toBe(1);
      const sourceBId = bResult.source.id;

      // Snapshot calendar B's origin row + event before the calendar-A upload.
      const bOriginBefore = await EventImportOriginEntity.findOne({
        where: { import_source_id: sourceBId, external_uid: SHARED_UID },
      });
      expect(bOriginBefore).not.toBeNull();
      const bEventId = bOriginBefore!.event_id;
      const bEventBefore = await EventEntity.findByPk(bEventId);
      expect(bEventBefore).not.toBeNull();

      // Upload a file to calendar A carrying the SAME external_uid. Calendar-wide
      // dedup is scoped to the uploading calendar (joined through
      // import_source.calendar_id), so calendar B's origin is NOT in calendar A's
      // dedup map: A must CREATE its own event, never update or re-point B's.
      const aResult = await calendarInterface.createImportSourceFromFile(
        account,
        calendarA.id,
        icsWith(SHARED_UID, 'Calendar A Event'),
        'a.ics',
      );
      expect(aResult.run.eventsCreated).toBe(1);
      expect(aResult.run.eventsUpdated).toBe(0);
      const sourceAId = aResult.source.id;

      // Calendar A got its own separate event + origin.
      const aOrigin = await EventImportOriginEntity.findOne({
        where: { import_source_id: sourceAId, external_uid: SHARED_UID },
      });
      expect(aOrigin).not.toBeNull();
      expect(aOrigin!.event_id).not.toBe(bEventId);

      // Calendar B's origin row is UNTOUCHED: still owned by source B (not
      // re-pointed to source A) and still bound to the same event.
      const bOriginAfter = await EventImportOriginEntity.findOne({
        where: { external_uid: SHARED_UID, event_id: bEventId },
      });
      expect(bOriginAfter).not.toBeNull();
      expect(bOriginAfter!.import_source_id).toBe(sourceBId);
      expect(bOriginAfter!.event_id).toBe(bEventId);

      // And calendar B's event still exists (content preserved, not deleted).
      const bEventAfter = await EventEntity.findByPk(bEventId);
      expect(bEventAfter).not.toBeNull();
      expect(bEventAfter!.calendar_id).toBe(calendarB.id);
    });
  });
});
