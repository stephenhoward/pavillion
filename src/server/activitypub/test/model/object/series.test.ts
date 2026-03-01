import { describe, it, expect } from 'vitest';
import { Calendar } from '@/common/model/calendar';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { SeriesObject } from '@/server/activitypub/model/object/series';

describe('SeriesObject', () => {

  function makeSeries(id: string, calendarId: string, urlName: string = 'myseries'): EventSeries {
    const series = new EventSeries(id, calendarId, urlName);
    const content = new EventSeriesContent('en', 'My Series', 'A description');
    series.addContent(content);
    return series;
  }

  describe('AP ID format', () => {

    it('should use UUID-based AP ID format', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const series = makeSeries('series-uuid-1234', 'calendar-uuid');

      const obj = new SeriesObject(calendar, series);

      expect(obj.id).toBe('https://pavillion.dev/calendars/mycal/series/series-uuid-1234');
    });

    it('should use calendar urlName in the AP ID', () => {
      const calendar = new Calendar('cal-id', 'testcalendar');
      const series = makeSeries('series-abc', 'cal-id');

      const obj = new SeriesObject(calendar, series);

      expect(obj.id).toContain('/calendars/testcalendar/series/');
      expect(obj.id).toContain('series-abc');
    });

  });

  describe('static seriesUrl', () => {

    it('should generate AP URL for a series UUID', () => {
      const calendar = new Calendar('cal-id', 'mycal');
      const series = makeSeries('series-uuid', 'cal-id');

      const url = SeriesObject.seriesUrl(calendar, series);

      expect(url).toBe('https://pavillion.dev/calendars/mycal/series/series-uuid');
    });

    it('should accept a string series ID', () => {
      const calendar = new Calendar('cal-id', 'mycal');

      const url = SeriesObject.seriesUrl(calendar, 'some-uuid');

      expect(url).toBe('https://pavillion.dev/calendars/mycal/series/some-uuid');
    });

    it('should return an already-absolute URL unchanged', () => {
      const calendar = new Calendar('cal-id', 'mycal');

      const url = SeriesObject.seriesUrl(calendar, 'https://other.instance/calendars/cal/series/123');

      expect(url).toBe('https://other.instance/calendars/cal/series/123');
    });

  });

  describe('attributedTo', () => {

    it('should set attributedTo to the calendar actor URL', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const series = makeSeries('series-uuid', 'calendar-uuid');

      const obj = new SeriesObject(calendar, series);

      expect(obj.attributedTo).toBe('https://pavillion.dev/calendars/mycal');
    });

  });

  describe('type', () => {

    it('should have type set to OrderedCollection', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const series = makeSeries('series-uuid', 'calendar-uuid');

      const obj = new SeriesObject(calendar, series);

      expect(obj.type).toBe('OrderedCollection');
    });

  });

  describe('content serialization', () => {

    it('should include multilingual content from the series', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const series = new EventSeries('series-uuid', 'calendar-uuid', 'myseries');
      const enContent = new EventSeriesContent('en', 'My Series', 'A description');
      const frContent = new EventSeriesContent('fr', 'Ma Série', 'Une description');
      series.addContent(enContent);
      series.addContent(frContent);

      const obj = new SeriesObject(calendar, series);

      expect(obj.content).toHaveProperty('en');
      expect(obj.content).toHaveProperty('fr');
    });

    it('should include name and description in content', () => {
      const calendar = new Calendar('calendar-uuid', 'mycal');
      const series = new EventSeries('series-uuid', 'calendar-uuid', 'myseries');
      const content = new EventSeriesContent('en', 'Test Series Name', 'Test description');
      series.addContent(content);

      const obj = new SeriesObject(calendar, series);

      expect(obj.content['en'].name).toBe('Test Series Name');
      expect(obj.content['en'].description).toBe('Test description');
    });

  });

});
