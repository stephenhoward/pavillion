import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { DateTime } from 'luxon';

import CalendarService from '@/site/service/calendar';
import ModelService from '@/client/service/models';
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
