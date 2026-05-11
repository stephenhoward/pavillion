import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import CalendarService from '@/site/service/calendar';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';
import { Calendar } from '@/common/model/calendar';
import CalendarEventInstance from '@/common/model/event_instance';

describe('CalendarService.loadEventInstance', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: any;
  let mockEventStore: any;
  let service: CalendarService;

  beforeEach(() => {
    mockStore = {};
    mockEventStore = {
      addEvent: sandbox.stub(),
    };
    service = new CalendarService(mockStore, mockEventStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('fetches the instance via the new nested route with a timestamp slug', async () => {
    const startTime = DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' });
    const apiResponse = {
      id: 'inst-1',
      event: {
        id: 'evt-1',
        calendarId: 'cal-1',
        content: [],
      },
      calendarId: 'cal-1',
      start: '2026-05-08T18:00:00.000Z',
      end: null,
      isCancelled: false,
    };
    const getModel = sandbox.stub(ModelService, 'getModel').resolves(apiResponse);

    const result = await service.loadEventInstance('evt-1', startTime);

    expect(getModel.calledOnce).toBe(true);
    expect(getModel.firstCall.args[0]).toBe(
      '/api/public/v1/events/evt-1/instances/20260508-1800',
    );
    expect(result).toBeInstanceOf(CalendarEventInstance);
    expect(result?.id).toBe('inst-1');
    expect(mockEventStore.addEvent.calledOnce).toBe(true);
  });

  it('converts zoned DateTimes to UTC for the slug', async () => {
    // 2026-05-08 14:00 America/New_York (EDT, UTC-4) == 18:00 UTC
    const startTime = DateTime.fromISO('2026-05-08T14:00:00', {
      zone: 'America/New_York',
    });
    const getModel = sandbox.stub(ModelService, 'getModel').resolves(null);

    await service.loadEventInstance('evt-1', startTime);

    expect(getModel.firstCall.args[0]).toBe(
      '/api/public/v1/events/evt-1/instances/20260508-1800',
    );
  });

  it('returns null when the API returns null (404 upstream)', async () => {
    const startTime = DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' });
    sandbox.stub(ModelService, 'getModel').resolves(null);

    const result = await service.loadEventInstance('evt-1', startTime);

    expect(result).toBeNull();
    expect(mockEventStore.addEvent.called).toBe(false);
  });

  it('re-throws non-404 errors (e.g. 400 or 429)', async () => {
    const startTime = DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' });
    const rateLimitError = new Error('Request failed with status code 429');
    sandbox.stub(ModelService, 'getModel').rejects(rateLimitError);

    await expect(
      service.loadEventInstance('evt-1', startTime),
    ).rejects.toThrow('Request failed with status code 429');
    expect(mockEventStore.addEvent.called).toBe(false);
  });

  it('re-throws a 400 error for malformed input', async () => {
    const startTime = DateTime.fromISO('2026-05-08T18:00:00Z', { zone: 'utc' });
    const badRequestError = new Error('Request failed with status code 400');
    sandbox.stub(ModelService, 'getModel').rejects(badRequestError);

    await expect(
      service.loadEventInstance('evt-1', startTime),
    ).rejects.toThrow('Request failed with status code 400');
  });
});

describe('CalendarService.listPublicCalendars', () => {
  const sandbox = sinon.createSandbox();
  let service: CalendarService;

  beforeEach(() => {
    service = new CalendarService({} as any, {} as any);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('maps a row with valid content[] into a Calendar with populated CalendarContent per language', async () => {
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-1',
          urlName: 'mycal',
          content: [
            { language: 'en', name: 'My Calendar', description: 'English desc' },
            { language: 'es', name: 'Mi Calendario', description: 'Spanish desc' },
          ],
          lastEventActivity: '2026-05-08T12:00:00.000Z',
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result).toHaveLength(1);
    expect(result[0].calendar).toBeInstanceOf(Calendar);
    expect(result[0].calendar.id).toBe('cal-1');
    expect(result[0].calendar.urlName).toBe('mycal');
    expect(result[0].calendar.getLanguages().sort()).toEqual(['en', 'es']);
    expect(result[0].calendar.content('en').name).toBe('My Calendar');
    expect(result[0].calendar.content('en').description).toBe('English desc');
    expect(result[0].calendar.content('es').name).toBe('Mi Calendario');
    expect(result[0].calendar.content('es').description).toBe('Spanish desc');
    expect(result[0].lastEventActivity).toBe('2026-05-08T12:00:00.000Z');
  });

  it('produces a Calendar with no preloaded content when row.content is null', async () => {
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-2',
          urlName: 'empty-content-null',
          content: null,
          lastEventActivity: null,
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result).toHaveLength(1);
    expect(result[0].calendar).toBeInstanceOf(Calendar);
    expect(result[0].calendar.getLanguages()).toEqual([]);
  });

  it('produces a Calendar with no preloaded content when row.content is an empty array', async () => {
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-3',
          urlName: 'empty-content-arr',
          content: [],
          lastEventActivity: null,
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result).toHaveLength(1);
    expect(result[0].calendar.getLanguages()).toEqual([]);
  });

  it('silently discards content entries missing a language', async () => {
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-4',
          urlName: 'partial',
          content: [
            { language: 'en', name: 'Has lang', description: 'd' },
            { name: 'No lang', description: 'd' },
            { language: null, name: 'Null lang', description: 'd' },
            null,
          ],
          lastEventActivity: null,
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result).toHaveLength(1);
    expect(result[0].calendar.getLanguages()).toEqual(['en']);
    expect(result[0].calendar.content('en').name).toBe('Has lang');
  });

  it('defaults missing name and description to empty string', async () => {
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-5',
          urlName: 'defaults',
          content: [
            { language: 'en' },
          ],
          lastEventActivity: null,
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result[0].calendar.content('en').name).toBe('');
    expect(result[0].calendar.content('en').description).toBe('');
  });

  it('passes lastEventActivity through as null when the API returns null', async () => {
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-6',
          urlName: 'no-activity',
          content: [{ language: 'en', name: 'n', description: 'd' }],
          lastEventActivity: null,
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result[0].lastEventActivity).toBeNull();
  });

  it('passes lastEventActivity through as the ISO string supplied by the API', async () => {
    // PublicCalendarListing types lastEventActivity as `string | null` — the
    // backend serializes the timestamp as an ISO 8601 string.
    sandbox.stub(ModelService, 'listModels').resolves(
      ListResult.fromArray([
        {
          id: 'cal-7',
          urlName: 'with-activity',
          content: [{ language: 'en', name: 'n', description: 'd' }],
          lastEventActivity: '2026-04-22T09:30:00.000Z',
        },
      ]),
    );

    const result = await service.listPublicCalendars();

    expect(result[0].lastEventActivity).toBe('2026-04-22T09:30:00.000Z');
    expect(typeof result[0].lastEventActivity).toBe('string');
  });
});
