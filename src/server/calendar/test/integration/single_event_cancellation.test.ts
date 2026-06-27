import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import { DateTime } from 'luxon';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { InvalidOccurrenceDateError } from '@/common/exceptions/calendar';

/**
 * Service-level integration tests for cancellation of SINGLE (non-recurring)
 * events, exercised against a real (in-memory) database through
 * CalendarInterface — not stubbed persistence.
 *
 * The occurrence-cancellation machinery (cancelOccurrenceByDate,
 * assertDateMatchesOccurrence, the exclusion-row model) was built for recurring
 * events but must work identically for a one-off event, whose lone rdate is the
 * only occurrence. These tests prove that, plus the Wave-1 "cancellation
 * follows the event" re-key: when an owner edits the date of a cancelled single
 * event via updateEvent, the exclusion row is re-keyed onto the new start so
 * the event stays cancelled at its new date and carries no cancellation at the
 * old one.
 *
 * The chain is driven end-to-end through the persistence layer:
 *   createEvent -> buildEventInstances -> cancelOccurrenceByDate ->
 *   updateEvent (date edit) -> buildEventInstances -> listEventInstances.
 * CalendarInterface does not install the eventBus -> buildEventInstances
 * handler, so instance materialization is invoked explicitly for determinism.
 */
describe('Single-event cancellation (service integration, real DB)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let account: Account;
  let calendar: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    // Minimal AP interface stub: these tests stay on local-only code paths,
    // but listing helpers and lookups expect the interface to be present.
    calendarInterface.setActivityPubInterface({
      getSharedEventIds: async () => [],
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
      getEventSourceActorUris: async () => new Map(),
    } as never);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('single-cancel@pavillion.dev', 'testpassword');
    account = info.account;
    calendar = await calendarInterface.createCalendar(account, 'singlecancel');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  /**
   * Create a single, non-recurring event whose lone schedule starts at `start`.
   * Returns the created event (with its schedule populated) so callers can read
   * the schedule id / startDate for subsequent cancel and re-key operations.
   */
  async function createSingleEvent(start: DateTime, name: string): Promise<CalendarEvent> {
    return calendarInterface.createEvent(account, {
      calendarId: calendar.id,
      content: { en: { name, description: 'single non-recurring event' } },
      schedules: [{
        start: start.toISO(),
        eventEndTime: start.plus({ hours: 1 }).toISO(),
      }],
    });
  }

  it('cancels a non-recurring single occurrence in shown mode (hideFromPublic=false)', async () => {
    const start = DateTime.fromISO('2026-08-15T10:00:00.000Z', { zone: 'utc' });
    const event = await createSingleEvent(start, 'Shown Cancel Single');
    expect(event.schedules.length).toBe(1);

    // Materialize the lone instance, then confirm it starts active.
    await calendarInterface.buildEventInstances(event);
    const before = await calendarInterface.listEventInstances(event);
    expect(before.length).toBe(1);
    expect(before[0].isCancelled).toBe(false);

    // Cancel the single occurrence in shown mode. The exclusion row is keyed to
    // the schedule's start; the rdate still produces the occurrence, so the
    // listing layer marks it isCancelled rather than dropping it.
    await calendarInterface.cancelOccurrenceByDate(account, event.id, event.schedules[0].startDate!, false);

    const after = await calendarInterface.listEventInstances(event);
    expect(after.length).toBe(1);
    expect(after[0].isCancelled).toBe(true);
    expect(after[0].start.toUTC().toMillis()).toBe(start.toMillis());
  });

  it('accepts a past-dated single occurrence (assertDateMatchesOccurrence)', async () => {
    // A one-off event well in the past. Its rdate is still a valid occurrence,
    // so cancelOccurrenceByDate must NOT raise InvalidOccurrenceDateError.
    const start = DateTime.fromISO('2020-03-09T18:30:00.000Z', { zone: 'utc' });
    const event = await createSingleEvent(start, 'Past Single');
    await calendarInterface.buildEventInstances(event);

    // The cancel call validates the date against the RRuleSet via
    // assertDateMatchesOccurrence; a past single occurrence must validate.
    await expect(
      calendarInterface.cancelOccurrenceByDate(account, event.id, event.schedules[0].startDate!, false),
    ).resolves.toBeUndefined();

    const after = await calendarInterface.listEventInstances(event);
    expect(after.length).toBe(1);
    expect(after[0].isCancelled).toBe(true);

    // A date that does NOT coincide with the lone rdate must be rejected,
    // proving the validation is real and not vacuously passing past dates.
    await expect(
      calendarInterface.cancelOccurrenceByDate(account, event.id, start.plus({ hours: 1 }), false),
    ).rejects.toBeInstanceOf(InvalidOccurrenceDateError);
  });

  it('restores a cancelled single occurrence (cancel -> restore round-trip)', async () => {
    const start = DateTime.fromISO('2026-10-01T09:00:00.000Z', { zone: 'utc' });
    const event = await createSingleEvent(start, 'Restore Single');
    await calendarInterface.buildEventInstances(event);

    await calendarInterface.cancelOccurrenceByDate(account, event.id, event.schedules[0].startDate!, false);
    const cancelled = await calendarInterface.listEventInstances(event);
    expect(cancelled.length).toBe(1);
    expect(cancelled[0].isCancelled).toBe(true);

    // Restore deletes the exclusion row; the occurrence returns to active.
    await calendarInterface.restoreOccurrenceByDate(account, event.id, event.schedules[0].startDate!);
    const restored = await calendarInterface.listEventInstances(event);
    expect(restored.length).toBe(1);
    expect(restored[0].isCancelled).toBe(false);
  });

  it('cancellation follows the event when its date is edited (exclusion re-keyed)', async () => {
    const oldStart = DateTime.fromISO('2026-11-05T14:00:00.000Z', { zone: 'utc' });
    const newStart = DateTime.fromISO('2026-12-20T14:00:00.000Z', { zone: 'utc' });

    const event = await createSingleEvent(oldStart, 'Re-key Single');
    const scheduleId = event.schedules[0].id!;
    await calendarInterface.buildEventInstances(event);

    // Cancel at the original date (shown mode).
    await calendarInterface.cancelOccurrenceByDate(account, event.id, event.schedules[0].startDate!, false);
    const atOld = await calendarInterface.listEventInstances(event);
    expect(atOld.length).toBe(1);
    expect(atOld[0].start.toUTC().toMillis()).toBe(oldStart.toMillis());
    expect(atOld[0].isCancelled).toBe(true);

    // Edit the single event's date through updateEvent. reconcileSchedules must
    // re-key the exclusion row from oldStart to newStart so the cancellation
    // travels with the event.
    const updated = await calendarInterface.updateEvent(account, event.id, {
      schedules: [{ id: scheduleId, start: newStart.toISO() }],
    });

    // Rebuild instances from the updated schedules: the old instance is removed
    // and a single instance is materialized at the new date.
    await calendarInterface.buildEventInstances(updated);
    const atNew = await calendarInterface.listEventInstances(updated);

    // Exactly one instance, now at the NEW date, still cancelled.
    expect(atNew.length).toBe(1);
    expect(atNew[0].start.toUTC().toMillis()).toBe(newStart.toMillis());
    expect(atNew[0].isCancelled).toBe(true);

    // The old date carries nothing — no lingering instance and no lingering
    // cancellation keyed to oldStart.
    const lingeringOld = atNew.find(
      i => i.start.toUTC().toMillis() === oldStart.toMillis(),
    );
    expect(lingeringOld).toBeUndefined();
  });
});
