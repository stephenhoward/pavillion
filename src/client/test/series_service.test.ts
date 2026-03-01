import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import SeriesService from '@/client/service/series';
import ModelService from '@/client/service/models';
import { EventSeries } from '@/common/model/event_series';
import { SeriesNotFoundError, SeriesEventCalendarMismatchError } from '@/common/exceptions/series';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { UnknownError } from '@/common/exceptions';
import { useSeriesStore } from '@/client/stores/seriesStore';

// Mock axios
vi.mock('axios');

describe('SeriesService', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useSeriesStore>;
  let service: SeriesService;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      series: {},
      addSeries: sandbox.stub(),
      updateSeries: sandbox.stub(),
      setSeriesForCalendar: sandbox.stub(),
      removeSeries: sandbox.stub(),
    } as unknown as ReturnType<typeof useSeriesStore>;
    // Create service with mock store
    service = new SeriesService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('loadSeries', () => {
    it('should load series for a calendar', async () => {
      const mockSeriesData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'summer-concerts',
        mediaId: null,
        eventCount: 5,
        content: {
          en: { language: 'en', name: 'Summer Concerts', description: '' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockSeriesData] });

      const result = await service.loadSeries('cal-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/calendars/cal-123/series')).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(EventSeries);
      expect(mockStore.setSeriesForCalendar.calledWith('cal-123', result)).toBe(true);
    });

    it('should attach eventCount to each series', async () => {
      const mockSeriesData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'summer-concerts',
        mediaId: null,
        eventCount: 7,
        content: {
          en: { language: 'en', name: 'Summer Concerts', description: '' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockSeriesData] });

      const result = await service.loadSeries('cal-123');

      expect((result[0] as any).eventCount).toBe(7);
    });

    it('should handle errors and log them', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      axiosGetStub.rejects(testError);

      await expect(service.loadSeries('cal-123')).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error loading calendar series:', testError)).toBe(true);
    });
  });

  describe('saveSeries', () => {
    it('should create a new series', async () => {
      const series = new EventSeries('', 'cal-123', 'new-series');
      series.content('en').name = 'New Series';

      const mockResponseData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'new-series',
        mediaId: null,
        content: {
          en: { language: 'en', name: 'New Series', description: '' },
        },
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.resolves(mockResponseData);

      const result = await service.saveSeries(series);

      expect(mockCreateModel.calledOnce).toBe(true);
      expect(mockCreateModel.calledWith(series, '/api/v1/calendars/cal-123/series')).toBe(true);
      expect(result).toBeInstanceOf(EventSeries);
      expect(mockStore.addSeries.calledWith('cal-123', result)).toBe(true);
    });

    it('should update an existing series', async () => {
      const series = new EventSeries('series-123', 'cal-123', 'existing-series');
      series.content('en').name = 'Updated Series';

      const mockResponseData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'existing-series',
        mediaId: null,
        content: {
          en: { language: 'en', name: 'Updated Series', description: '' },
        },
      };

      const mockUpdateModel = sandbox.stub(ModelService, 'updateModel');
      mockUpdateModel.resolves(mockResponseData);

      const result = await service.saveSeries(series);

      expect(mockUpdateModel.calledOnce).toBe(true);
      expect(mockUpdateModel.calledWith(series, '/api/v1/calendars/cal-123/series')).toBe(true);
      expect(result).toBeInstanceOf(EventSeries);
      expect(mockStore.updateSeries.calledWith('cal-123', result)).toBe(true);
    });

    it('should throw error if series has no calendarId', async () => {
      const series = new EventSeries('', '', 'no-calendar');

      await expect(service.saveSeries(series)).rejects.toThrow('Series must have a calendarId');
    });

    it('should handle API errors', async () => {
      const series = new EventSeries('', 'cal-123', 'new-series');
      series.content('en').name = 'New Series';

      const mockError = {
        response: {
          data: {
            errorName: 'CalendarNotFoundError',
          },
        },
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.rejects(mockError);

      await expect(service.saveSeries(series)).rejects.toThrow(CalendarNotFoundError);
    });
  });

  describe('getSeries', () => {
    it('should get a specific series', async () => {
      const mockSeriesData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'summer-concerts',
        mediaId: null,
        content: {
          en: { language: 'en', name: 'Summer Concerts', description: '' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: mockSeriesData });

      const result = await service.getSeries('series-123', 'cal-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/calendars/cal-123/series/series-123')).toBe(true);
      expect(result).toBeInstanceOf(EventSeries);
    });

    it('should handle SeriesNotFoundError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'SeriesNotFoundError',
          },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getSeries('series-123', 'cal-123')).rejects.toThrow(SeriesNotFoundError);
    });
  });

  describe('deleteSeries', () => {
    it('should delete a series', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteSeries('series-123', 'cal-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/calendars/cal-123/series/series-123')).toBe(true);
    });

    it('should remove series from store after deletion', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: {} });

      await service.deleteSeries('series-123', 'cal-123');

      expect(mockStore.removeSeries.calledWith('cal-123', 'series-123')).toBe(true);
    });

    it('should handle delete errors', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'SeriesNotFoundError',
          },
        },
      };

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.deleteSeries('series-123', 'cal-123')).rejects.toThrow(SeriesNotFoundError);
    });
  });

  describe('assignSeries', () => {
    it('should assign a series to an event', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves();

      await service.assignSeries('event-123', 'series-123');

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith('/api/v1/events/event-123/series/series-123')).toBe(true);
    });

    it('should handle assignment errors', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'SeriesEventCalendarMismatchError',
          },
        },
      };

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.rejects(mockError);

      await expect(service.assignSeries('event-123', 'series-123')).rejects.toThrow(SeriesEventCalendarMismatchError);
    });

    it('should URL-encode event IDs with special characters', async () => {
      const eventIdWithUrl = 'https://pavillion.dev/events/event-123';
      const encodedEventId = encodeURIComponent(eventIdWithUrl);

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves();

      await service.assignSeries(eventIdWithUrl, 'series-123');

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith(`/api/v1/events/${encodedEventId}/series/series-123`)).toBe(true);
    });
  });

  describe('clearSeries', () => {
    it('should clear a series assignment from an event', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves();

      await service.clearSeries('event-123', 'series-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/events/event-123/series/series-123')).toBe(true);
    });

    it('should handle clear errors', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'InsufficientCalendarPermissionsError',
          },
        },
      };

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.clearSeries('event-123', 'series-123')).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('getEventSeries', () => {
    it('should get the series for an event', async () => {
      const mockSeriesData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'summer-concerts',
        mediaId: null,
        content: {
          en: { language: 'en', name: 'Summer Concerts', description: '' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: mockSeriesData });

      const result = await service.getEventSeries('event-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/events/event-123/series')).toBe(true);
      expect(result).toBeInstanceOf(EventSeries);
    });

    it('should return null when event has no series', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: null });

      const result = await service.getEventSeries('event-123');

      expect(result).toBeNull();
    });

    it('should handle errors and log them', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      axiosGetStub.rejects(testError);

      await expect(service.getEventSeries('event-123')).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error loading event series:', testError)).toBe(true);
    });

    it('should URL-encode event IDs with special characters', async () => {
      const eventIdWithUrl = 'https://pavillion.dev/events/event-123';
      const encodedEventId = encodeURIComponent(eventIdWithUrl);
      const mockSeriesData = {
        id: 'series-123',
        calendarId: 'cal-123',
        urlName: 'summer-concerts',
        mediaId: null,
        content: {
          en: { language: 'en', name: 'Summer Concerts', description: '' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: mockSeriesData });

      await service.getEventSeries(eventIdWithUrl);

      expect(axiosGetStub.calledWith(`/api/v1/events/${encodedEventId}/series`)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw UnknownError for unrecognized errors', async () => {
      const mockError = new Error('Unknown error');
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getSeries('series-123', 'cal-123')).rejects.toThrow(UnknownError);
    });

    it('should handle malformed error responses', async () => {
      const mockError = {
        response: {
          data: {
            // Missing errorName
          },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getSeries('series-123', 'cal-123')).rejects.toThrow(UnknownError);
    });
  });
});
