import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSeriesStore } from '@/client/stores/seriesStore';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';

describe('SeriesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('addSeries', () => {
    it('should add a series to the store', () => {
      const store = useSeriesStore();
      const series = new EventSeries('series-1', 'calendar-123', 'my-series');
      series.addContent(new EventSeriesContent('en', 'My Series'));

      store.addSeries('calendar-123', series);

      expect(store.series['calendar-123']).toHaveLength(1);
      expect(store.series['calendar-123'][0]).toStrictEqual(series);
    });

    it('should create calendar array if it does not exist', () => {
      const store = useSeriesStore();
      const series = new EventSeries('series-1', 'new-calendar', 'my-series');

      store.addSeries('new-calendar', series);

      expect(store.series['new-calendar']).toBeDefined();
      expect(store.series['new-calendar']).toHaveLength(1);
    });

    it('should add multiple series to the same calendar', () => {
      const store = useSeriesStore();
      const series1 = new EventSeries('series-1', 'calendar-123', 'first-series');
      const series2 = new EventSeries('series-2', 'calendar-123', 'second-series');

      store.addSeries('calendar-123', series1);
      store.addSeries('calendar-123', series2);

      expect(store.series['calendar-123']).toHaveLength(2);
    });
  });

  describe('updateSeries', () => {
    it('should update an existing series', () => {
      const store = useSeriesStore();
      const originalSeries = new EventSeries('series-1', 'calendar-123', 'original-url');
      originalSeries.addContent(new EventSeriesContent('en', 'Original Name'));

      store.addSeries('calendar-123', originalSeries);

      const updatedSeries = new EventSeries('series-1', 'calendar-123', 'updated-url');
      updatedSeries.addContent(new EventSeriesContent('en', 'Updated Name'));

      store.updateSeries('calendar-123', updatedSeries);

      expect(store.series['calendar-123']).toHaveLength(1);
      expect(store.series['calendar-123'][0]).toStrictEqual(updatedSeries);
      expect(store.series['calendar-123'][0].content('en').name).toBe('Updated Name');
    });

    it('should add series if it does not exist', () => {
      const store = useSeriesStore();
      const series = new EventSeries('series-1', 'calendar-123', 'new-series');
      series.addContent(new EventSeriesContent('en', 'New Series'));

      store.updateSeries('calendar-123', series);

      expect(store.series['calendar-123']).toHaveLength(1);
      expect(store.series['calendar-123'][0]).toStrictEqual(series);
    });

    it('should create calendar array if it does not exist', () => {
      const store = useSeriesStore();
      const series = new EventSeries('series-1', 'new-calendar', 'my-series');

      store.updateSeries('new-calendar', series);

      expect(store.series['new-calendar']).toBeDefined();
      expect(store.series['new-calendar']).toHaveLength(1);
    });
  });

  describe('setSeriesForCalendar', () => {
    it('should set series for a calendar', () => {
      const store = useSeriesStore();
      const series1 = new EventSeries('series-1', 'calendar-123', 'first');
      const series2 = new EventSeries('series-2', 'calendar-123', 'second');
      const seriesList = [series1, series2];

      store.setSeriesForCalendar('calendar-123', seriesList);

      expect(store.series['calendar-123']).toHaveLength(2);
      expect(store.series['calendar-123']).toStrictEqual(seriesList);
    });

    it('should replace existing series', () => {
      const store = useSeriesStore();
      const oldSeries = new EventSeries('old-series', 'calendar-123', 'old');
      store.addSeries('calendar-123', oldSeries);

      const newSeriesList = [
        new EventSeries('series-1', 'calendar-123', 'first'),
        new EventSeries('series-2', 'calendar-123', 'second'),
      ];

      store.setSeriesForCalendar('calendar-123', newSeriesList);

      expect(store.series['calendar-123']).toHaveLength(2);
      expect(store.series['calendar-123']).toStrictEqual(newSeriesList);
      expect(store.series['calendar-123']).not.toContain(oldSeries);
    });
  });

  describe('removeSeries', () => {
    it('should remove a series by ID', () => {
      const store = useSeriesStore();
      const series1 = new EventSeries('series-1', 'calendar-123', 'first');
      const series2 = new EventSeries('series-2', 'calendar-123', 'second');

      store.addSeries('calendar-123', series1);
      store.addSeries('calendar-123', series2);

      expect(store.series['calendar-123']).toHaveLength(2);

      store.removeSeries('calendar-123', 'series-1');

      expect(store.series['calendar-123']).toHaveLength(1);
      expect(store.series['calendar-123'][0]).toStrictEqual(series2);
    });

    it('should handle removing from non-existent calendar', () => {
      const store = useSeriesStore();

      // Should not throw error
      store.removeSeries('non-existent-calendar', 'series-1');

      expect(store.series['non-existent-calendar']).toBeUndefined();
    });

    it('should handle removing non-existent series', () => {
      const store = useSeriesStore();
      const series = new EventSeries('series-1', 'calendar-123', 'my-series');
      store.addSeries('calendar-123', series);

      store.removeSeries('calendar-123', 'non-existent-series');

      expect(store.series['calendar-123']).toHaveLength(1);
      expect(store.series['calendar-123'][0]).toStrictEqual(series);
    });
  });
});
