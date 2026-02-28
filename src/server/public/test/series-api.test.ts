import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { CalendarEvent } from '@/common/model/events';
import { SeriesNotFoundError } from '@/common/exceptions/series';
import { testApp } from '@/server/common/test/lib/express';
import CalendarRoutes from '@/server/public/api/v1/calendar';
import PublicCalendarInterface from '@/server/public/interface';
import CalendarInterface from '@/server/calendar/interface';

function makeSeries(id: string, calendarId: string, urlName: string): EventSeries {
  const series = new EventSeries(id, calendarId, urlName);
  const content = new EventSeriesContent('en');
  content.name = `Series ${urlName}`;
  series.addContent(content);
  return series;
}

describe('Public Series API', () => {
  let routes: CalendarRoutes;
  let router: express.Router;
  let publicInterface: PublicCalendarInterface;
  let calendarInterface: CalendarInterface;
  let apiSandbox: sinon.SinonSandbox = sinon.createSandbox();

  beforeEach(() => {
    calendarInterface = new CalendarInterface(new EventEmitter());
    publicInterface = new PublicCalendarInterface(new EventEmitter(), calendarInterface);
    routes = new CalendarRoutes(publicInterface);
    router = express.Router();
  });

  afterEach(() => {
    apiSandbox.restore();
  });

  describe('GET /calendar/:urlName/series', () => {
    it('should return 404 for non-existent calendar', async () => {
      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      calendarStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'nonexistent';
        routes.listSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return series array with event counts for existing calendar', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series1 = makeSeries('series-1', 'cal-id', 'yoga-classes');
      const series2 = makeSeries('series-2', 'cal-id', 'book-club');

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesStub = apiSandbox.stub(publicInterface, 'listSeriesForCalendar');

      calendarStub.resolves(calendar);
      seriesStub.resolves([
        { series: series1, eventCount: 5 },
        { series: series2, eventCount: 3 },
      ]);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].urlName).toBe('yoga-classes');
      expect(response.body[0].eventCount).toBe(5);
      expect(response.body[1].urlName).toBe('book-club');
      expect(response.body[1].eventCount).toBe(3);
      expect(calendarStub.called).toBe(true);
      expect(seriesStub.calledWith(calendar)).toBe(true);
    });

    it('should return empty array for calendar with no series', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesStub = apiSandbox.stub(publicInterface, 'listSeriesForCalendar');

      calendarStub.resolves(calendar);
      seriesStub.resolves([]);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 500 for service errors', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesStub = apiSandbox.stub(publicInterface, 'listSeriesForCalendar');

      calendarStub.resolves(calendar);
      seriesStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        routes.listSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve series');
    });
  });

  describe('GET /calendar/:urlName/series/:seriesUrlName', () => {
    it('should return 404 for non-existent calendar', async () => {
      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      calendarStub.resolves(null);

      router.get('/handler', (req, res) => {
        req.params.urlName = 'nonexistent';
        req.params.seriesUrlName = 'some-series';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 404 for non-existent series', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesByUrlStub = apiSandbox.stub(publicInterface, 'getSeriesByUrlName');

      calendarStub.resolves(calendar);
      seriesByUrlStub.rejects(new SeriesNotFoundError());

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'nonexistent-series';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('series not found');
      expect(response.body.errorName).toBe('SeriesNotFoundError');
    });

    it('should return series detail with events and pagination info', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries('series-1', 'cal-id', 'yoga-classes');
      const event1 = new CalendarEvent('event-1', 'cal-id');
      const event2 = new CalendarEvent('event-2', 'cal-id');

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesByUrlStub = apiSandbox.stub(publicInterface, 'getSeriesByUrlName');
      const seriesEventsStub = apiSandbox.stub(publicInterface, 'getSeriesEvents');

      calendarStub.resolves(calendar);
      seriesByUrlStub.resolves(series);
      seriesEventsStub.resolves({ events: [event1, event2], total: 2 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.urlName).toBe('yoga-classes');
      expect(response.body.events).toHaveLength(2);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBe(2);
      expect(response.body.pagination.limit).toBe(20);
      expect(response.body.pagination.offset).toBe(0);
      expect(seriesByUrlStub.calledWith('cal-id', 'yoga-classes')).toBe(true);
      expect(seriesEventsStub.calledWith('series-1', 'cal-id', 20, 0)).toBe(true);
    });

    it('should use custom limit and offset for pagination', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries('series-1', 'cal-id', 'yoga-classes');

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesByUrlStub = apiSandbox.stub(publicInterface, 'getSeriesByUrlName');
      const seriesEventsStub = apiSandbox.stub(publicInterface, 'getSeriesEvents');

      calendarStub.resolves(calendar);
      seriesByUrlStub.resolves(series);
      seriesEventsStub.resolves({ events: [], total: 50 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        req.query.limit = '10';
        req.query.offset = '20';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(10);
      expect(response.body.pagination.offset).toBe(20);
      expect(seriesEventsStub.calledWith('series-1', 'cal-id', 10, 20)).toBe(true);
    });

    it('should cap limit at 100', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries('series-1', 'cal-id', 'yoga-classes');

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesByUrlStub = apiSandbox.stub(publicInterface, 'getSeriesByUrlName');
      const seriesEventsStub = apiSandbox.stub(publicInterface, 'getSeriesEvents');

      calendarStub.resolves(calendar);
      seriesByUrlStub.resolves(series);
      seriesEventsStub.resolves({ events: [], total: 200 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        req.query.limit = '500';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(100);
      expect(seriesEventsStub.calledWith('series-1', 'cal-id', 100, 0)).toBe(true);
    });

    it('should default to limit 20 and offset 0 when not provided', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries('series-1', 'cal-id', 'yoga-classes');

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesByUrlStub = apiSandbox.stub(publicInterface, 'getSeriesByUrlName');
      const seriesEventsStub = apiSandbox.stub(publicInterface, 'getSeriesEvents');

      calendarStub.resolves(calendar);
      seriesByUrlStub.resolves(series);
      seriesEventsStub.resolves({ events: [], total: 0 });

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(20);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should return 500 for unexpected service errors', async () => {
      const calendar = new Calendar('cal-id', 'test-calendar');
      const series = makeSeries('series-1', 'cal-id', 'yoga-classes');

      const calendarStub = apiSandbox.stub(publicInterface, 'getCalendarByName');
      const seriesByUrlStub = apiSandbox.stub(publicInterface, 'getSeriesByUrlName');
      const seriesEventsStub = apiSandbox.stub(publicInterface, 'getSeriesEvents');

      calendarStub.resolves(calendar);
      seriesByUrlStub.resolves(series);
      seriesEventsStub.rejects(new Error('Database error'));

      router.get('/handler', (req, res) => {
        req.params.urlName = 'test-calendar';
        req.params.seriesUrlName = 'yoga-classes';
        routes.getSeries(req, res);
      });

      const response = await request(testApp(router)).get('/handler');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve series');
    });
  });
});
