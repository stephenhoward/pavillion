// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import i18next from 'i18next';

const { errorMock, warnMock, serializeMock } = vi.hoisted(() => ({
  errorMock: vi.fn(),
  warnMock: vi.fn(),
  serializeMock: vi.fn(),
}));
vi.mock('@/server/common/helper/logger', () => ({
  default: { info: vi.fn(), error: errorMock, warn: warnMock, debug: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: errorMock, warn: warnMock, debug: vi.fn() }),
}));
vi.mock('@/server/calendar/service/export/ics_serializer', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/calendar/service/export/ics_serializer')>(),
  serializeCalendarToIcs: serializeMock,
}));

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ValidationError } from '@/common/exceptions/base';
import { CalendarExportError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';
import { CalendarContentEntity } from '@/server/calendar/entity/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import CalendarService from '@/server/calendar/service/calendar';
import CalendarExportService from '@/server/calendar/service/export/export_service';
import { IcsSerializationError } from '@/server/calendar/service/export/ics_serializer';

/**
 * CalendarExportService with the database and the serializer stubbed: the
 * check order and the failure handling. The file itself, ownership against
 * real membership rows and the language set are covered end to end in
 * integration/calendar_export.test.ts.
 */
describe('CalendarExportService', () => {
  const CALENDAR_ID = '550e8400-e29b-41d4-a716-446655440000';
  const account = new Account('account-id', 'owner', 'owner@example.com');
  const sandbox = sinon.createSandbox();

  let calendarService: { getCalendar: sinon.SinonStub; isCalendarOwner: sinon.SinonStub };
  let service: CalendarExportService;

  beforeAll(async () => {
    // In-memory bundles, so the service finds its namespace loaded.
    await i18next.init({
      lng: 'en',
      resources: {
        en: { calendar_export: { accessibility_heading: 'Accessibility' } },
        es: { calendar_export: { accessibility_heading: 'Accesibilidad' } },
      },
    });
  });

  beforeEach(() => {
    calendarService = {
      getCalendar: sandbox.stub().resolves(new Calendar(CALENDAR_ID, 'townhall')),
      isCalendarOwner: sandbox.stub().resolves(true),
    };
    service = new CalendarExportService(calendarService as unknown as CalendarService);
    sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(CalendarContentEntity, 'findAll').resolves([{ language: 'en' }] as CalendarContentEntity[]);
    serializeMock.mockReset();
    errorMock.mockReset();
    warnMock.mockReset();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('refuses an unknown calendar before anything else', async () => {
    calendarService.getCalendar.resolves(null);

    await expect(service.exportCalendarIcs(account, CALENDAR_ID, 'en')).rejects.toBeInstanceOf(CalendarNotFoundError);
    expect(calendarService.isCalendarOwner.called).toBe(false);
  });

  it('refuses an account that does not own the calendar, before reading the language', async () => {
    calendarService.isCalendarOwner.resolves(false);

    await expect(service.exportCalendarIcs(account, CALENDAR_ID, 'not-a-language'))
      .rejects.toBeInstanceOf(CalendarEditorPermissionError);
    await expect(service.listExportLanguages(account, CALENDAR_ID))
      .rejects.toBeInstanceOf(CalendarEditorPermissionError);
    expect(serializeMock).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['repeated', ['en', 'es']],
    ['outside the set', 'de'],
  ])('refuses a %s language and never defaults one', async (_label, lang) => {
    await expect(service.exportCalendarIcs(account, CALENDAR_ID, lang)).rejects.toBeInstanceOf(ValidationError);
    expect(serializeMock).not.toHaveBeenCalled();
  });

  it('falls back to the languages column only when nothing else names a language', async () => {
    (CalendarContentEntity.findAll as sinon.SinonStub).resolves([]);
    const calendar = new Calendar(CALENDAR_ID, 'townhall');
    calendar.languages = ['fr'];
    calendarService.getCalendar.resolves(calendar);

    expect(await service.listExportLanguages(account, CALENDAR_ID)).toEqual(['fr']);
  });

  it('returns the file, its count and its filename', async () => {
    serializeMock.mockReturnValue({ ics: 'BEGIN:VCALENDAR\r\n', eventCount: 2, skippedEventIds: [] });

    const result = await service.exportCalendarIcs(account, CALENDAR_ID, 'en');

    expect(result).toEqual({ ics: 'BEGIN:VCALENDAR\r\n', eventCount: 2, filename: 'townhall-en.ics' });
    const input = serializeMock.mock.calls[0][0];
    expect(input.language).toBe('en');
    expect(input.fallbackLanguages).toEqual(['en']);
  });

  it('gives the serializer a heading in the row\'s language, or the export language\'s when it has no bundle', async () => {
    serializeMock.mockReturnValue({ ics: '', eventCount: 0, skippedEventIds: [] });

    await service.exportCalendarIcs(account, CALENDAR_ID, 'en');
    const heading = serializeMock.mock.calls[0][0].accessibilityHeading;

    expect(heading('es')).toBe('Accesibilidad');
    expect(heading('xx')).toBe('Accessibility');
    expect(heading('__proto__')).toBe('Accessibility');
    expect(heading('../../etc')).toBe('Accessibility');
  });

  it('turns a per-event failure into the fixed export error, naming the event only in the log', async () => {
    serializeMock.mockImplementation(() => {
      throw new IcsSerializationError('event-1234', new Error('bad zone "Mars/Base"'));
    });

    const failure = await service.exportCalendarIcs(account, CALENDAR_ID, 'en').catch(error => error);

    expect(failure).toBeInstanceOf(CalendarExportError);
    expect(failure.message).toBe('Calendar export failed');
    expect(errorMock).toHaveBeenCalledOnce();
    expect(errorMock.mock.calls[0][0]).toMatchObject({ calendarId: CALENDAR_ID, eventId: 'event-1234' });
  });

  it('turns any other serializer failure, such as a RangeError, into the same export error', async () => {
    const cause = new RangeError('Time zone span 1970 to 9999 is wider than 250 years');
    serializeMock.mockImplementation(() => {
      throw cause;
    });

    const failure = await service.exportCalendarIcs(account, CALENDAR_ID, 'en').catch(error => error);

    expect(failure).toBeInstanceOf(CalendarExportError);
    expect(failure.message).toBe('Calendar export failed');
    expect(errorMock).toHaveBeenCalledOnce();
    expect(errorMock.mock.calls[0][0]).toMatchObject({ err: cause, calendarId: CALENDAR_ID });
  });

  it('logs each event left out for having no dated schedule at warn', async () => {
    serializeMock.mockReturnValue({ ics: '', eventCount: 1, skippedEventIds: ['event-a', 'event-b'] });

    await service.exportCalendarIcs(account, CALENDAR_ID, 'en');

    expect(warnMock).toHaveBeenCalledTimes(2);
    expect(warnMock.mock.calls.map(call => call[0])).toEqual([
      { calendarId: CALENDAR_ID, eventId: 'event-a' },
      { calendarId: CALENDAR_ID, eventId: 'event-b' },
    ]);
  });
});
