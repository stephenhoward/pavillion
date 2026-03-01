import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import sinon from 'sinon';
import SeriesService from '../service/series';
import CalendarService from '../service/calendar';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventSeries } from '@/common/model/event_series';
import { CalendarEvent } from '@/common/model/events';
import { EventSeriesEntity, EventSeriesContentEntity } from '../entity/event_series';
import { EventEntity } from '../entity/event';
import { MediaEntity } from '@/server/media/entity/media';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  SeriesNotFoundError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
  SeriesEventCalendarMismatchError,
} from '@/common/exceptions/series';
import db from '@/server/common/entity/db';

describe('SeriesService', () => {
  let sandbox: sinon.SinonSandbox;
  let seriesService: SeriesService;
  let mockCalendarService: sinon.SinonStubbedInstance<CalendarService>;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();

    // Create mock CalendarService
    mockCalendarService = sandbox.createStubInstance(CalendarService);
    seriesService = new SeriesService(mockCalendarService as any, eventBus);

    // Create test data
    testAccount = new Account('account-123', 'testuser', 'test@example.com');
    testCalendar = new Calendar('calendar-123', 'testcalendar');
  });

  afterEach(() => {
    sandbox.restore();
    eventBus.removeAllListeners();
  });

  describe('isValidUrlName', () => {
    it('should return true for valid URL names', () => {
      expect(seriesService.isValidUrlName('myseries')).toBe(true);
      expect(seriesService.isValidUrlName('my_series')).toBe(true);
      expect(seriesService.isValidUrlName('series123')).toBe(true);
      expect(seriesService.isValidUrlName('abc')).toBe(true);
    });

    it('should return false for invalid URL names', () => {
      expect(seriesService.isValidUrlName('_noleadunderscore')).toBe(false);
      expect(seriesService.isValidUrlName('ab')).toBe(false); // too short
      expect(seriesService.isValidUrlName('thisisamuchtoolongusernamethatexceeds')).toBe(false);
      expect(seriesService.isValidUrlName('no spaces')).toBe(false);
      expect(seriesService.isValidUrlName('')).toBe(false);
      expect(seriesService.isValidUrlName('has-hyphen')).toBe(false);
    });
  });

  describe('createSeries', () => {
    it('should create a new series with content', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventSeriesEntity, 'findOne').resolves(null);
      const saveStub = sandbox.stub(EventSeriesEntity.prototype, 'save');
      const contentSaveStub = sandbox.stub(EventSeriesContentEntity.prototype, 'save');

      const seriesData = {
        urlName: 'myseries',
        content: {
          en: {
            name: 'My Series',
            description: 'A test series',
          },
        },
      };

      const series = await seriesService.createSeries(testAccount, 'calendar-123', seriesData);

      expect(series).toBeInstanceOf(EventSeries);
      expect(series.calendarId).toBe('calendar-123');
      expect(series.urlName).toBe('myseries');

      expect(saveStub.calledOnce).toBeTruthy();
      expect(contentSaveStub.calledOnce).toBeTruthy();

      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw CalendarNotFoundError for non-existent calendar', async () => {
      mockCalendarService.getCalendar.resolves(null);

      const seriesData = { urlName: 'myseries' };

      await expect(
        seriesService.createSeries(testAccount, 'non-existent-calendar', seriesData),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw InsufficientCalendarPermissionsError for unauthorized user', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      const seriesData = { urlName: 'myseries' };

      await expect(
        seriesService.createSeries(testAccount, 'calendar-123', seriesData),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw InvalidSeriesUrlNameError for invalid urlName', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const seriesData = { urlName: 'invalid url name' };

      await expect(
        seriesService.createSeries(testAccount, 'calendar-123', seriesData),
      ).rejects.toThrow(InvalidSeriesUrlNameError);
    });

    it('should throw InvalidSeriesUrlNameError when urlName is missing', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const seriesData = {};

      await expect(
        seriesService.createSeries(testAccount, 'calendar-123', seriesData),
      ).rejects.toThrow(InvalidSeriesUrlNameError);
    });

    it('should throw SeriesUrlNameAlreadyExistsError for duplicate urlName', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const existingEntity = EventSeriesEntity.build({
        id: 'existing-series-id',
        calendar_id: 'calendar-123',
        url_name: 'myseries',
      });
      sandbox.stub(EventSeriesEntity, 'findOne').resolves(existingEntity);

      const seriesData = { urlName: 'myseries' };

      await expect(
        seriesService.createSeries(testAccount, 'calendar-123', seriesData),
      ).rejects.toThrow(SeriesUrlNameAlreadyExistsError);
    });

    it('should throw error when mediaId does not belong to the calendar', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventSeriesEntity, 'findOne').resolves(null);
      sandbox.stub(MediaEntity, 'findOne').resolves(null);

      const seriesData = { urlName: 'myseries', mediaId: 'media-from-other-calendar' };

      await expect(
        seriesService.createSeries(testAccount, 'calendar-123', seriesData),
      ).rejects.toThrow('Media not found or does not belong to this calendar');
    });

    it('should allow creating series with valid mediaId from the same calendar', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventSeriesEntity, 'findOne').resolves(null);
      sandbox.stub(EventSeriesEntity.prototype, 'save');
      sandbox.stub(MediaEntity, 'findOne').resolves({ id: 'media-123', calendar_id: 'calendar-123' } as any);

      const seriesData = { urlName: 'myseries', mediaId: 'media-123' };

      const series = await seriesService.createSeries(testAccount, 'calendar-123', seriesData);

      expect(series).toBeInstanceOf(EventSeries);
      expect(series.mediaId).toBe('media-123');
    });

    it('should emit mediaAttachedToSeries event when series is created with a mediaId', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventSeriesEntity, 'findOne').resolves(null);
      sandbox.stub(EventSeriesEntity.prototype, 'save');
      sandbox.stub(MediaEntity, 'findOne').resolves({ id: 'media-123', calendar_id: 'calendar-123' } as any);

      const emittedEvents: Array<{ mediaId: string; seriesId: string }> = [];
      eventBus.on('mediaAttachedToSeries', (payload) => {
        emittedEvents.push(payload);
      });

      const seriesData = { urlName: 'myseries', mediaId: 'media-123' };
      const series = await seriesService.createSeries(testAccount, 'calendar-123', seriesData);

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].mediaId).toBe('media-123');
      expect(emittedEvents[0].seriesId).toBe(series.id);
    });

    it('should NOT emit mediaAttachedToSeries when creating series without a mediaId', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventSeriesEntity, 'findOne').resolves(null);
      sandbox.stub(EventSeriesEntity.prototype, 'save');

      const emittedEvents: any[] = [];
      eventBus.on('mediaAttachedToSeries', (payload) => {
        emittedEvents.push(payload);
      });

      const seriesData = { urlName: 'myseries' };
      await seriesService.createSeries(testAccount, 'calendar-123', seriesData);

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('getSeries', () => {
    it('should return a series by ID', async () => {
      const mockEntity = EventSeriesEntity.build({
        id: 'series-123',
        calendar_id: 'calendar-123',
        url_name: 'myseries',
      });
      mockEntity.content = [];

      sandbox.stub(EventSeriesEntity, 'findByPk').resolves(mockEntity);

      const series = await seriesService.getSeries('series-123');

      expect(series).toBeInstanceOf(EventSeries);
      expect(series.id).toBe('series-123');
      expect(series.urlName).toBe('myseries');
    });

    it('should throw SeriesNotFoundError for non-existent series', async () => {
      sandbox.stub(EventSeriesEntity, 'findByPk').resolves(null);

      await expect(
        seriesService.getSeries('non-existent-id'),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should throw SeriesNotFoundError for cross-calendar mismatch', async () => {
      const mockEntity = EventSeriesEntity.build({
        id: 'series-123',
        calendar_id: 'calendar-456',
        url_name: 'myseries',
      });
      mockEntity.content = [];

      sandbox.stub(EventSeriesEntity, 'findByPk').resolves(mockEntity);

      await expect(
        seriesService.getSeries('series-123', 'calendar-123'),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should return series when calendarId matches', async () => {
      const mockEntity = EventSeriesEntity.build({
        id: 'series-123',
        calendar_id: 'calendar-123',
        url_name: 'myseries',
      });
      mockEntity.content = [];

      sandbox.stub(EventSeriesEntity, 'findByPk').resolves(mockEntity);

      const series = await seriesService.getSeries('series-123', 'calendar-123');

      expect(series).toBeInstanceOf(EventSeries);
      expect(series.calendarId).toBe('calendar-123');
    });
  });

  describe('getSeriesByUrlName', () => {
    it('should return a series by URL name', async () => {
      const mockEntity = EventSeriesEntity.build({
        id: 'series-123',
        calendar_id: 'calendar-123',
        url_name: 'myseries',
      });
      mockEntity.content = [];

      sandbox.stub(EventSeriesEntity, 'findOne').resolves(mockEntity);

      const series = await seriesService.getSeriesByUrlName('calendar-123', 'myseries');

      expect(series).toBeInstanceOf(EventSeries);
      expect(series.urlName).toBe('myseries');
    });

    it('should throw SeriesNotFoundError when series not found', async () => {
      sandbox.stub(EventSeriesEntity, 'findOne').resolves(null);

      await expect(
        seriesService.getSeriesByUrlName('calendar-123', 'nonexistent'),
      ).rejects.toThrow(SeriesNotFoundError);
    });
  });

  describe('getSeriesForCalendar', () => {
    it('should return all series for a calendar', async () => {
      const mockEntity1 = EventSeriesEntity.build({
        id: 'series-1',
        calendar_id: 'calendar-123',
        url_name: 'series1',
      });
      const mockEntity2 = EventSeriesEntity.build({
        id: 'series-2',
        calendar_id: 'calendar-123',
        url_name: 'series2',
      });
      mockEntity1.content = [];
      mockEntity2.content = [];

      sandbox.stub(EventSeriesEntity, 'findAll').resolves([mockEntity1, mockEntity2]);

      const seriesList = await seriesService.getSeriesForCalendar('calendar-123');

      expect(seriesList).toHaveLength(2);
      expect(seriesList[0]).toBeInstanceOf(EventSeries);
      expect(seriesList[1]).toBeInstanceOf(EventSeries);
    });

    it('should return empty array for calendar with no series', async () => {
      sandbox.stub(EventSeriesEntity, 'findAll').resolves([]);

      const seriesList = await seriesService.getSeriesForCalendar('calendar-123');

      expect(seriesList).toHaveLength(0);
    });
  });

  describe('updateSeries', () => {
    it('should update series content with permission checks', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      const getStub = sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const mockContentEntity = EventSeriesContentEntity.build({
        series_id: 'series-123',
        language: 'en',
        name: 'Updated Name',
      });
      sandbox.stub(EventSeriesContentEntity, 'findOne').resolves(mockContentEntity);
      const saveStub = sandbox.stub(mockContentEntity, 'save').resolves(mockContentEntity);

      const updateData = {
        content: {
          en: {
            name: 'Updated Name',
          },
        },
      };

      // Mock second getSeries call (after update)
      getStub.onSecondCall().resolves(new EventSeries('series-123', 'calendar-123', 'myseries'));

      const result = await seriesService.updateSeries(testAccount, 'series-123', updateData);

      expect(result).toBeInstanceOf(EventSeries);
      expect(saveStub.calledOnce).toBeTruthy();
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw Error when attempting to change urlName', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const updateData = { urlName: 'newname' };

      await expect(
        seriesService.updateSeries(testAccount, 'series-123', updateData),
      ).rejects.toThrow('Series urlName is immutable and cannot be changed after creation');
    });

    it('should allow updating when urlName is same as existing (no-op)', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      const getStub = sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      getStub.onSecondCall().resolves(new EventSeries('series-123', 'calendar-123', 'myseries'));

      const updateData = { urlName: 'myseries' }; // same value, should not throw

      const result = await seriesService.updateSeries(testAccount, 'series-123', updateData);
      expect(result).toBeInstanceOf(EventSeries);
    });

    it('should throw SeriesNotFoundError for non-existent series', async () => {
      sandbox.stub(seriesService, 'getSeries').rejects(new SeriesNotFoundError());

      const updateData = { content: { en: { name: 'Updated' } } };

      await expect(
        seriesService.updateSeries(testAccount, 'series-123', updateData),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should throw InsufficientCalendarPermissionsError for unauthorized user', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      const updateData = { content: { en: { name: 'Updated' } } };

      await expect(
        seriesService.updateSeries(testAccount, 'series-123', updateData),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw error when updating with mediaId from different calendar', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(MediaEntity, 'findOne').resolves(null);

      const updateData = { mediaId: 'media-from-other-calendar' };

      await expect(
        seriesService.updateSeries(testAccount, 'series-123', updateData),
      ).rejects.toThrow('Media not found or does not belong to this calendar');
    });

    it('should throw SeriesNotFoundError for cross-calendar mismatch', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-456', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      const updateData = { content: { en: { name: 'Updated' } } };

      await expect(
        seriesService.updateSeries(testAccount, 'series-123', updateData, 'calendar-123'),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should emit mediaAttachedToSeries when updating series with a new mediaId', async () => {
      // Series currently has no media
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      const getStub = sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(MediaEntity, 'findOne').resolves({ id: 'media-456', calendar_id: 'calendar-123' } as any);
      sandbox.stub(EventSeriesEntity, 'update').resolves([1]);

      getStub.onSecondCall().resolves(new EventSeries('series-123', 'calendar-123', 'myseries'));

      const emittedEvents: Array<{ mediaId: string; seriesId: string }> = [];
      eventBus.on('mediaAttachedToSeries', (payload) => {
        emittedEvents.push(payload);
      });

      await seriesService.updateSeries(testAccount, 'series-123', { mediaId: 'media-456' });

      expect(emittedEvents).toHaveLength(1);
      expect(emittedEvents[0].mediaId).toBe('media-456');
      expect(emittedEvents[0].seriesId).toBe('series-123');
    });

    it('should NOT emit mediaAttachedToSeries when updating with the same mediaId (no change)', async () => {
      // Series already has media-456 attached
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      mockSeries.mediaId = 'media-456';
      const getStub = sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(MediaEntity, 'findOne').resolves({ id: 'media-456', calendar_id: 'calendar-123' } as any);
      sandbox.stub(EventSeriesEntity, 'update').resolves([1]);

      getStub.onSecondCall().resolves(mockSeries);

      const emittedEvents: any[] = [];
      eventBus.on('mediaAttachedToSeries', (payload) => {
        emittedEvents.push(payload);
      });

      await seriesService.updateSeries(testAccount, 'series-123', { mediaId: 'media-456' });

      expect(emittedEvents).toHaveLength(0);
    });

    it('should NOT emit mediaAttachedToSeries when clearing media (mediaId: null)', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      mockSeries.mediaId = 'media-456';
      const getStub = sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventSeriesEntity, 'update').resolves([1]);

      getStub.onSecondCall().resolves(new EventSeries('series-123', 'calendar-123', 'myseries'));

      const emittedEvents: any[] = [];
      eventBus.on('mediaAttachedToSeries', (payload) => {
        emittedEvents.push(payload);
      });

      await seriesService.updateSeries(testAccount, 'series-123', { mediaId: null });

      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('deleteSeries', () => {
    it('should delete series and clear series_id from associated events', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const mockTransaction = {
        commit: sandbox.stub(),
        rollback: sandbox.stub(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);

      const eventUpdateStub = sandbox.stub(EventEntity, 'update').resolves([0]);
      const contentDestroyStub = sandbox.stub(EventSeriesContentEntity, 'destroy').resolves(0);
      const seriesDestroyStub = sandbox.stub(EventSeriesEntity, 'destroy').resolves(1);

      await seriesService.deleteSeries(testAccount, 'series-123');

      expect(eventUpdateStub.calledOnce).toBeTruthy();
      expect(contentDestroyStub.calledOnce).toBeTruthy();
      expect(seriesDestroyStub.calledOnce).toBeTruthy();
      expect(mockTransaction.commit.calledOnce).toBeTruthy();

      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw SeriesNotFoundError for non-existent series', async () => {
      sandbox.stub(seriesService, 'getSeries').rejects(new SeriesNotFoundError());

      await expect(
        seriesService.deleteSeries(testAccount, 'series-123'),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should throw InsufficientCalendarPermissionsError for unauthorized user', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      await expect(
        seriesService.deleteSeries(testAccount, 'series-123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw SeriesNotFoundError for cross-calendar mismatch', async () => {
      sandbox.stub(seriesService, 'getSeries').rejects(new SeriesNotFoundError());

      await expect(
        seriesService.deleteSeries(testAccount, 'series-123', 'calendar-123'),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should rollback transaction on error', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const mockTransaction = {
        commit: sandbox.stub(),
        rollback: sandbox.stub(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);

      sandbox.stub(EventEntity, 'update').rejects(new Error('DB error'));

      await expect(
        seriesService.deleteSeries(testAccount, 'series-123'),
      ).rejects.toThrow('DB error');

      expect(mockTransaction.rollback.calledOnce).toBeTruthy();
    });
  });

  describe('setSeriesForEvent', () => {
    it('should assign a series to an event', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const updateStub = sandbox.stub(EventEntity, 'update').resolves([1]);

      await seriesService.setSeriesForEvent(testAccount, 'event-123', 'series-123');

      expect(updateStub.calledOnce).toBeTruthy();
      expect(updateStub.calledWith(
        { series_id: 'series-123' },
        { where: { id: 'event-123' } },
      )).toBeTruthy();
    });

    it('should throw EventNotFoundError if event does not exist', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(null);

      await expect(
        seriesService.setSeriesForEvent(testAccount, 'non-existent-event', 'series-123'),
      ).rejects.toThrow(EventNotFoundError);
    });

    it('should throw error for remote events (no calendar_id)', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: null,
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      await expect(
        seriesService.setSeriesForEvent(testAccount, 'event-123', 'series-123'),
      ).rejects.toThrow('Cannot assign series to remote events');
    });

    it('should throw SeriesEventCalendarMismatchError when event and series are in different calendars', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      const mockSeries = new EventSeries('series-123', 'calendar-456', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      await expect(
        seriesService.setSeriesForEvent(testAccount, 'event-123', 'series-123'),
      ).rejects.toThrow(SeriesEventCalendarMismatchError);
    });

    it('should throw InsufficientCalendarPermissionsError for unauthorized user', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      await expect(
        seriesService.setSeriesForEvent(testAccount, 'event-123', 'series-123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw SeriesNotFoundError if series does not exist', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      sandbox.stub(seriesService, 'getSeries').rejects(new SeriesNotFoundError());

      await expect(
        seriesService.setSeriesForEvent(testAccount, 'event-123', 'non-existent-series'),
      ).rejects.toThrow(SeriesNotFoundError);
    });
  });

  describe('clearSeriesForEvent', () => {
    it('should clear the series assignment from an event', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
        series_id: 'series-123',
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const updateStub = sandbox.stub(EventEntity, 'update').resolves([1]);

      await seriesService.clearSeriesForEvent(testAccount, 'event-123');

      expect(updateStub.calledOnce).toBeTruthy();
      expect(updateStub.calledWith(
        { series_id: null },
        { where: { id: 'event-123' } },
      )).toBeTruthy();
    });

    it('should throw EventNotFoundError if event does not exist', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(null);

      await expect(
        seriesService.clearSeriesForEvent(testAccount, 'non-existent-event'),
      ).rejects.toThrow(EventNotFoundError);
    });

    it('should throw error for remote events (no calendar_id)', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: null,
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      await expect(
        seriesService.clearSeriesForEvent(testAccount, 'event-123'),
      ).rejects.toThrow('Cannot modify series assignment on remote events');
    });

    it('should throw InsufficientCalendarPermissionsError for unauthorized user', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
      });
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      await expect(
        seriesService.clearSeriesForEvent(testAccount, 'event-123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('getEventSeries', () => {
    it('should return the series assigned to an event', async () => {
      const mockSeriesEntity = EventSeriesEntity.build({
        id: 'series-123',
        calendar_id: 'calendar-123',
        url_name: 'myseries',
      });
      mockSeriesEntity.content = [];

      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
        series_id: 'series-123',
      });
      (mockEventEntity as any).series = mockSeriesEntity;

      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      const result = await seriesService.getEventSeries('event-123');

      expect(result).toBeInstanceOf(EventSeries);
      expect(result!.id).toBe('series-123');
    });

    it('should return null when event has no series assigned', async () => {
      const mockEventEntity = EventEntity.build({
        id: 'event-123',
        calendar_id: 'calendar-123',
        series_id: null,
      });
      (mockEventEntity as any).series = null;

      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity);

      const result = await seriesService.getEventSeries('event-123');

      expect(result).toBeNull();
    });

    it('should throw EventNotFoundError if event does not exist', async () => {
      sandbox.stub(EventEntity, 'findByPk').resolves(null);

      await expect(
        seriesService.getEventSeries('non-existent-event'),
      ).rejects.toThrow(EventNotFoundError);
    });
  });

  describe('getSeriesStats', () => {
    it('should return a map of series IDs to event counts', async () => {
      const mockSeries1 = EventSeriesEntity.build({ id: 'series-1', calendar_id: 'calendar-123', url_name: 'series1' });
      const mockSeries2 = EventSeriesEntity.build({ id: 'series-2', calendar_id: 'calendar-123', url_name: 'series2' });

      sandbox.stub(EventSeriesEntity, 'findAll').resolves([mockSeries1, mockSeries2]);
      sandbox.stub(db, 'query').resolves([
        { series_id: 'series-1', event_count: '3' },
        { series_id: 'series-2', event_count: '1' },
      ] as any);

      const stats = await seriesService.getSeriesStats('calendar-123');

      expect(stats).toBeInstanceOf(Map);
      expect(stats.get('series-1')).toBe(3);
      expect(stats.get('series-2')).toBe(1);
    });

    it('should initialize series with 0 count when no events assigned', async () => {
      const mockSeries1 = EventSeriesEntity.build({ id: 'series-1', calendar_id: 'calendar-123', url_name: 'series1' });

      sandbox.stub(EventSeriesEntity, 'findAll').resolves([mockSeries1]);
      sandbox.stub(db, 'query').resolves([] as any);

      const stats = await seriesService.getSeriesStats('calendar-123');

      expect(stats.get('series-1')).toBe(0);
    });

    it('should return empty map when calendar has no series', async () => {
      sandbox.stub(EventSeriesEntity, 'findAll').resolves([]);

      const stats = await seriesService.getSeriesStats('calendar-123');

      expect(stats.size).toBe(0);
    });

    it('should return accurate counts for partial assignments', async () => {
      const mockSeries1 = EventSeriesEntity.build({ id: 'series-1', calendar_id: 'calendar-123', url_name: 'series1' });
      const mockSeries2 = EventSeriesEntity.build({ id: 'series-2', calendar_id: 'calendar-123', url_name: 'series2' });

      sandbox.stub(EventSeriesEntity, 'findAll').resolves([mockSeries1, mockSeries2]);
      // Only series-1 has events; series-2 has none
      sandbox.stub(db, 'query').resolves([
        { series_id: 'series-1', event_count: '5' },
      ] as any);

      const stats = await seriesService.getSeriesStats('calendar-123');

      expect(stats.get('series-1')).toBe(5);
      expect(stats.get('series-2')).toBe(0);
    });
  });

  describe('getSeriesEvents', () => {
    it('should return all events belonging to a series', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      const mockEventEntity1 = EventEntity.build({
        id: 'event-1',
        calendar_id: 'calendar-123',
        series_id: 'series-123',
      });
      const mockEventEntity2 = EventEntity.build({
        id: 'event-2',
        calendar_id: 'calendar-123',
        series_id: 'series-123',
      });
      mockEventEntity1.content = [];
      mockEventEntity2.content = [];

      sandbox.stub(EventEntity, 'findAll').resolves([mockEventEntity1, mockEventEntity2]);

      const events = await seriesService.getSeriesEvents('series-123');

      expect(events).toHaveLength(2);
      expect(events[0]).toBeInstanceOf(CalendarEvent);
      expect(events[1]).toBeInstanceOf(CalendarEvent);
    });

    it('should return empty array when series has no events', async () => {
      const mockSeries = new EventSeries('series-123', 'calendar-123', 'myseries');
      sandbox.stub(seriesService, 'getSeries').resolves(mockSeries);

      sandbox.stub(EventEntity, 'findAll').resolves([]);

      const events = await seriesService.getSeriesEvents('series-123');

      expect(events).toHaveLength(0);
    });

    it('should throw SeriesNotFoundError if series does not exist', async () => {
      sandbox.stub(seriesService, 'getSeries').rejects(new SeriesNotFoundError());

      await expect(
        seriesService.getSeriesEvents('non-existent-series'),
      ).rejects.toThrow(SeriesNotFoundError);
    });

    it('should enforce calendar scope when calendarId is provided', async () => {
      sandbox.stub(seriesService, 'getSeries').rejects(new SeriesNotFoundError());

      await expect(
        seriesService.getSeriesEvents('series-123', 'calendar-456'),
      ).rejects.toThrow(SeriesNotFoundError);
    });
  });
});
