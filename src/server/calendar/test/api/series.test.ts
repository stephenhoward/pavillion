// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { EventSeries } from '@/common/model/event_series';
import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import {
  SeriesNotFoundError,
  SeriesUrlNameAlreadyExistsError,
  InvalidSeriesUrlNameError,
  DuplicateSeriesNameError,
  SeriesEventCalendarMismatchError,
} from '@/common/exceptions/series';
import { EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { testApp, addRequestUser } from '@/server/common/test/lib/express';
import SeriesRoutes from '@/server/calendar/api/v1/series';
import CalendarInterface from '@/server/calendar/interface';

// Import entities to register with Sequelize before CalendarInterface initialization
import db from '@/server/common/entity/db';
import '@/server/common/entity/account';
import '@/server/calendar/entity/calendar';
import '@/server/calendar/entity/calendar_member';
import '@/server/calendar/entity/event_category';
import '@/server/calendar/entity/event_category_content';
import '@/server/calendar/entity/event';
import '@/server/calendar/entity/event_category_assignment';
import '@/server/calendar/entity/event_instance';
import '@/server/calendar/entity/location';
import '@/server/calendar/entity/event_series';
import '@/server/calendar/entity/event_series_content';
import '@/server/activitypub/entity/activitypub';
import '@/server/media/entity/media';
import '@/server/configuration/entity/settings';

describe('Series API', () => {
  let routes: SeriesRoutes;
  let router: express.Router;
  let calendarInterface: CalendarInterface;
  let seriesSandbox: sinon.SinonSandbox = sinon.createSandbox();

  // Sync database schema before any tests run
  beforeAll(async () => {
    await db.sync({ force: true });
  });

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    routes = new SeriesRoutes(calendarInterface);
    router = express.Router();
  });

  afterEach(() => {
    seriesSandbox.restore();
  });

  // Helper to create a mock EventSeries
  function makeSeries(id: string = 'series-id', calendarId: string = 'calendar-id'): EventSeries {
    return new EventSeries(id, calendarId, 'my-series');
  }

  describe('GET /calendars/:calendarId/series', () => {
    it('should return series for a valid calendar', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockSeries = makeSeries();

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getSeriesForCalendarStub = seriesSandbox.stub(calendarInterface, 'getSeriesForCalendar');
      const getSeriesStatsStub = seriesSandbox.stub(calendarInterface, 'getSeriesStats');

      getCalendarStub.resolves(mockCalendar);
      getSeriesForCalendarStub.resolves([mockSeries]);
      getSeriesStatsStub.resolves(new Map([['series-id', 3]]));

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.getSeriesForCalendar(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('series-id');
      expect(response.body[0].eventCount).toBe(3);
      expect(getSeriesForCalendarStub.called).toBe(true);
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'nonexistent';
        routes.getSeriesForCalendar(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should handle server errors gracefully', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      getCalendarStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.getSeriesForCalendar(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('POST /calendars/:calendarId/series', () => {
    it('should fail without authentication', async () => {
      router.post('/handler', (req, res) => { routes.createSeries(req, res); });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for series creation. Not logged in?');
    });

    it('should create series successfully', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockSeries = makeSeries();

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const createStub = seriesSandbox.stub(calendarInterface, 'createSeries');

      getCalendarStub.resolves(mockCalendar);
      createStub.resolves(mockSeries);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe('series-id');
      expect(createStub.called).toBe(true);
      expect(createStub.firstCall.args[1]).toBe('calendar-id');
    });

    it('should resolve calendar by urlName and create series successfully', async () => {
      const mockCalendar = new Calendar('calendar-uuid', 'my-cal');
      const mockSeries = makeSeries('series-id', 'calendar-uuid');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');
      const createStub = seriesSandbox.stub(calendarInterface, 'createSeries');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(mockCalendar);
      createStub.resolves(mockSeries);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'my-cal';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(201);
      expect(createStub.called).toBe(true);
      expect(createStub.firstCall.args[1]).toBe('calendar-uuid');
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(null);

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 without editor permissions', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const createStub = seriesSandbox.stub(calendarInterface, 'createSeries');

      getCalendarStub.resolves(mockCalendar);
      createStub.rejects(new InsufficientCalendarPermissionsError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 409 when URL name already exists', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const createStub = seriesSandbox.stub(calendarInterface, 'createSeries');

      getCalendarStub.resolves(mockCalendar);
      createStub.rejects(new SeriesUrlNameAlreadyExistsError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('A series with this URL name already exists');
      expect(response.body.errorName).toBe('SeriesUrlNameAlreadyExistsError');
    });

    it('should return 400 for invalid URL name', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const createStub = seriesSandbox.stub(calendarInterface, 'createSeries');

      getCalendarStub.resolves(mockCalendar);
      createStub.rejects(new InvalidSeriesUrlNameError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: '_bad', content: { en: { name: 'My Series' } } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid series URL name');
      expect(response.body.errorName).toBe('InvalidSeriesUrlNameError');
    });

    it('should return 409 for duplicate series name', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const createStub = seriesSandbox.stub(calendarInterface, 'createSeries');

      getCalendarStub.resolves(mockCalendar);
      createStub.rejects(new DuplicateSeriesNameError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        routes.createSeries(req, res);
      });

      const response = await request(testApp(router))
        .post('/handler')
        .send({ urlName: 'my-series', content: { en: { name: 'Duplicate' } } });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('A series with this name already exists');
      expect(response.body.errorName).toBe('DuplicateSeriesNameError');
    });
  });

  describe('GET /calendars/:calendarId/series/:seriesId', () => {
    it('should return a series when found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockSeries = makeSeries();

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getSeriesStub = seriesSandbox.stub(calendarInterface, 'getSeries');

      getCalendarStub.resolves(mockCalendar);
      getSeriesStub.resolves(mockSeries);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('series-id');
      expect(getSeriesStub.called).toBe(true);
    });

    it('should return 404 when series not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getSeriesStub = seriesSandbox.stub(calendarInterface, 'getSeries');

      getCalendarStub.resolves(mockCalendar);
      getSeriesStub.rejects(new SeriesNotFoundError());

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'nonexistent';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Series not found');
      expect(response.body.errorName).toBe('SeriesNotFoundError');
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'nonexistent';
        req.params.seriesId = 'series-id';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });
  });

  describe('PUT /calendars/:calendarId/series/:seriesId', () => {
    it('should fail without authentication', async () => {
      router.put('/handler', (req, res) => { routes.updateSeries(req, res); });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for series update. Not logged in?');
    });

    it('should update series successfully', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockSeries = makeSeries();

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const updateStub = seriesSandbox.stub(calendarInterface, 'updateSeries');

      getCalendarStub.resolves(mockCalendar);
      updateStub.resolves(mockSeries);

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.updateSeries(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('series-id');
      expect(updateStub.called).toBe(true);
    });

    it('should return 404 when series not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const updateStub = seriesSandbox.stub(calendarInterface, 'updateSeries');

      getCalendarStub.resolves(mockCalendar);
      updateStub.rejects(new SeriesNotFoundError());

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'nonexistent';
        routes.updateSeries(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Series not found');
      expect(response.body.errorName).toBe('SeriesNotFoundError');
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(null);

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        req.params.seriesId = 'series-id';
        routes.updateSeries(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 without editor permissions', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const updateStub = seriesSandbox.stub(calendarInterface, 'updateSeries');

      getCalendarStub.resolves(mockCalendar);
      updateStub.rejects(new InsufficientCalendarPermissionsError());

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.updateSeries(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ content: { en: { name: 'Updated Name' } } });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 400 for invalid URL name', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const updateStub = seriesSandbox.stub(calendarInterface, 'updateSeries');

      getCalendarStub.resolves(mockCalendar);
      updateStub.rejects(new InvalidSeriesUrlNameError());

      router.put('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.updateSeries(req, res);
      });

      const response = await request(testApp(router))
        .put('/handler')
        .send({ urlName: '_bad' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid series URL name');
      expect(response.body.errorName).toBe('InvalidSeriesUrlNameError');
    });
  });

  describe('DELETE /calendars/:calendarId/series/:seriesId', () => {
    it('should fail without authentication', async () => {
      router.delete('/handler', (req, res) => { routes.deleteSeries(req, res); });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for series deletion. Not logged in?');
    });

    it('should delete series successfully', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const deleteStub = seriesSandbox.stub(calendarInterface, 'deleteSeries');

      getCalendarStub.resolves(mockCalendar);
      deleteStub.resolves();

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.deleteSeries(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(204);
      expect(deleteStub.called).toBe(true);
    });

    it('should return 404 when series not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const deleteStub = seriesSandbox.stub(calendarInterface, 'deleteSeries');

      getCalendarStub.resolves(mockCalendar);
      deleteStub.rejects(new SeriesNotFoundError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'nonexistent';
        routes.deleteSeries(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Series not found');
      expect(response.body.errorName).toBe('SeriesNotFoundError');
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(null);

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'nonexistent';
        req.params.seriesId = 'series-id';
        routes.deleteSeries(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 without editor permissions', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const deleteStub = seriesSandbox.stub(calendarInterface, 'deleteSeries');

      getCalendarStub.resolves(mockCalendar);
      deleteStub.rejects(new InsufficientCalendarPermissionsError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.deleteSeries(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });
  });

  describe('GET /calendars/:calendarId/series/:seriesId/events', () => {
    it('should return events for a series', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');
      const mockEvent = { id: 'event-id', toObject: () => ({ id: 'event-id' }) } as unknown as CalendarEvent;

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getSeriesEventsStub = seriesSandbox.stub(calendarInterface, 'getSeriesEvents');

      getCalendarStub.resolves(mockCalendar);
      getSeriesEventsStub.resolves([mockEvent]);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.getSeriesEvents(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('event-id');
      expect(getSeriesEventsStub.called).toBe(true);
    });

    it('should return 404 when series not found', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getSeriesEventsStub = seriesSandbox.stub(calendarInterface, 'getSeriesEvents');

      getCalendarStub.resolves(mockCalendar);
      getSeriesEventsStub.rejects(new SeriesNotFoundError());

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'nonexistent';
        routes.getSeriesEvents(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Series not found');
      expect(response.body.errorName).toBe('SeriesNotFoundError');
    });

    it('should return 404 when calendar not found', async () => {
      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getCalendarByNameStub = seriesSandbox.stub(calendarInterface, 'getCalendarByName');

      getCalendarStub.resolves(null);
      getCalendarByNameStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'nonexistent';
        req.params.seriesId = 'series-id';
        routes.getSeriesEvents(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should handle server errors gracefully', async () => {
      const mockCalendar = new Calendar('calendar-id', 'test-calendar');

      const getCalendarStub = seriesSandbox.stub(calendarInterface, 'getCalendar');
      const getSeriesEventsStub = seriesSandbox.stub(calendarInterface, 'getSeriesEvents');

      getCalendarStub.resolves(mockCalendar);
      getSeriesEventsStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.calendarId = 'calendar-id';
        req.params.seriesId = 'series-id';
        routes.getSeriesEvents(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('POST /events/:eventId/series/:seriesId', () => {
    it('should fail without authentication', async () => {
      router.post('/handler', (req, res) => { routes.setSeriesForEvent(req, res); });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for series assignment. Not logged in?');
    });

    it('should assign series to event successfully', async () => {
      const setSeriesStub = seriesSandbox.stub(calendarInterface, 'setSeriesForEvent');
      setSeriesStub.resolves();

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.setSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(204);
      expect(setSeriesStub.called).toBe(true);
      expect(setSeriesStub.firstCall.args[1]).toBe('event-id');
      expect(setSeriesStub.firstCall.args[2]).toBe('series-id');
    });

    it('should return 404 when event not found', async () => {
      const setSeriesStub = seriesSandbox.stub(calendarInterface, 'setSeriesForEvent');
      setSeriesStub.rejects(new EventNotFoundError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'nonexistent';
        req.params.seriesId = 'series-id';
        routes.setSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event not found');
      expect(response.body.errorName).toBe('EventNotFoundError');
    });

    it('should return 404 when series not found', async () => {
      const setSeriesStub = seriesSandbox.stub(calendarInterface, 'setSeriesForEvent');
      setSeriesStub.rejects(new SeriesNotFoundError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'nonexistent';
        routes.setSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Series not found');
      expect(response.body.errorName).toBe('SeriesNotFoundError');
    });

    it('should return 400 when event and series belong to different calendars', async () => {
      const setSeriesStub = seriesSandbox.stub(calendarInterface, 'setSeriesForEvent');
      setSeriesStub.rejects(new SeriesEventCalendarMismatchError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.setSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Event and series must belong to the same calendar');
      expect(response.body.errorName).toBe('SeriesEventCalendarMismatchError');
    });

    it('should return 403 without editor permissions', async () => {
      const setSeriesStub = seriesSandbox.stub(calendarInterface, 'setSeriesForEvent');
      setSeriesStub.rejects(new InsufficientCalendarPermissionsError());

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.setSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should handle server errors gracefully', async () => {
      const setSeriesStub = seriesSandbox.stub(calendarInterface, 'setSeriesForEvent');
      setSeriesStub.rejects(new Error('Database error'));

      router.post('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.setSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).post('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('DELETE /events/:eventId/series/:seriesId', () => {
    it('should fail without authentication', async () => {
      router.delete('/handler', (req, res) => { routes.clearSeriesForEvent(req, res); });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('missing account for series assignment. Not logged in?');
    });

    it('should clear series from event successfully', async () => {
      const clearSeriesStub = seriesSandbox.stub(calendarInterface, 'clearSeriesForEvent');
      clearSeriesStub.resolves();

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.clearSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(204);
      expect(clearSeriesStub.called).toBe(true);
      expect(clearSeriesStub.firstCall.args[1]).toBe('event-id');
    });

    it('should return 404 when event not found', async () => {
      const clearSeriesStub = seriesSandbox.stub(calendarInterface, 'clearSeriesForEvent');
      clearSeriesStub.rejects(new EventNotFoundError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'nonexistent';
        req.params.seriesId = 'series-id';
        routes.clearSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event not found');
      expect(response.body.errorName).toBe('EventNotFoundError');
    });

    it('should return 403 without editor permissions', async () => {
      const clearSeriesStub = seriesSandbox.stub(calendarInterface, 'clearSeriesForEvent');
      clearSeriesStub.rejects(new InsufficientCalendarPermissionsError());

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.clearSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Permission denied');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should handle server errors gracefully', async () => {
      const clearSeriesStub = seriesSandbox.stub(calendarInterface, 'clearSeriesForEvent');
      clearSeriesStub.rejects(new Error('Database error'));

      router.delete('/handler', addRequestUser, (req, res) => {
        req.params.eventId = 'event-id';
        req.params.seriesId = 'series-id';
        routes.clearSeriesForEvent(req, res);
      });

      const response = await request(testApp(router)).delete('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('GET /events/:eventId/series', () => {
    it('should return series when event has one assigned', async () => {
      const mockSeries = makeSeries();
      const getEventSeriesStub = seriesSandbox.stub(calendarInterface, 'getEventSeries');
      getEventSeriesStub.resolves(mockSeries);

      router.get('/handler', (req, res) => {
        req.params.eventId = 'event-id';
        routes.getEventSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).not.toBeNull();
      expect(response.body.id).toBe('series-id');
      expect(getEventSeriesStub.called).toBe(true);
      expect(getEventSeriesStub.firstCall.args[0]).toBe('event-id');
    });

    it('should return null when event has no series assigned', async () => {
      const getEventSeriesStub = seriesSandbox.stub(calendarInterface, 'getEventSeries');
      getEventSeriesStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.eventId = 'event-id';
        routes.getEventSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
      expect(getEventSeriesStub.called).toBe(true);
    });

    it('should return 404 when event not found', async () => {
      const getEventSeriesStub = seriesSandbox.stub(calendarInterface, 'getEventSeries');
      getEventSeriesStub.rejects(new EventNotFoundError());

      router.get('/handler', (req, res) => {
        req.params.eventId = 'nonexistent';
        routes.getEventSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Event not found');
      expect(response.body.errorName).toBe('EventNotFoundError');
    });

    it('should handle server errors gracefully', async () => {
      const getEventSeriesStub = seriesSandbox.stub(calendarInterface, 'getEventSeries');
      getEventSeriesStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.eventId = 'event-id';
        routes.getEventSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal server error');
    });
  });
});
