import { defineStore } from 'pinia';
import { EventSeries } from '@/common/model/event_series';

export const useSeriesStore = defineStore('series', {
  state: () => {
    return {
      series: {} as Record<string, EventSeries[]>,
    };
  },
  actions: {
    /**
     * Adds a new series to the store for the given calendar.
     *
     * @param {string} calendarId - The ID of the calendar to which the series belongs
     * @param {EventSeries} series - The series to add to the store
     */
    addSeries(calendarId: string, series: EventSeries) {
      if (!this.series[calendarId]) {
        this.series[calendarId] = [];
      }
      this.series[calendarId].push(series);
    },

    /**
     * Updates an existing series in the store or adds it if not found.
     *
     * @param {string} calendarId - The ID of the calendar to which the series belongs
     * @param {EventSeries} series - The series to update or add
     */
    updateSeries(calendarId: string, series: EventSeries) {
      if (!this.series[calendarId]) {
        this.series[calendarId] = [];
      }
      const index = this.series[calendarId].findIndex((s: EventSeries) => s.id === series.id);
      if (index >= 0) {
        this.series[calendarId][index] = series;
      }
      else {
        this.addSeries(calendarId, series);
      }
    },

    /**
     * Set series in the store for a specific calendar, replacing any existing entries.
     *
     * @param {string} calendarId - The ID of the calendar to which the series belong
     * @param {EventSeries[]} seriesList - The series to set in the store
     */
    setSeriesForCalendar(calendarId: string, seriesList: EventSeries[]) {
      this.series[calendarId] = seriesList;
    },

    /**
     * Remove a series from the store.
     *
     * @param {string} calendarId - The ID of the calendar to which the series belongs
     * @param {string} seriesId - The ID of the series to remove
     */
    removeSeries(calendarId: string, seriesId: string) {
      if (this.series[calendarId]) {
        this.series[calendarId] = this.series[calendarId].filter(
          (s: EventSeries) => s.id !== seriesId,
        );
      }
    },
  },
});
