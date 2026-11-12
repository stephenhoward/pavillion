import { describe, it, expect } from 'vitest';

import { Calendar, CalendarContent } from '@/common/model/calendar';
import { EventSeries } from '@/common/model/event_series';
import { EventSeriesContent } from '@/common/model/event_series_content';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { CalendarEvent, CalendarEventContent } from '@/common/model/events';
import { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import {
  PUBLIC_CONTENT_FIELDS,
  toPublicCalendarObject,
  toPublicSeriesObject,
  toPublicCategoryObject,
  toPublicEventObject,
} from '@/server/public/api/v1/calendar';

/**
 * The public projections allow-list per-language content fields. These tests
 * pin two things: every field a content model emits today is still served
 * (so the allow-list and the model cannot drift apart silently), and a key
 * the allow-list does not name never reaches the output.
 */
describe('public content projection', () => {
  const full = {
    calendar: new CalendarContent('en', 'Cal', 'Cal desc', 'Cal alt'),
    series: new EventSeriesContent('en', 'Series', 'Series desc', 'Series alt'),
    category: new EventCategoryContent('en', 'Category'),
    event: new CalendarEventContent('en', 'Event', 'Event desc', 'Step-free', 'Event alt'),
    location: new EventLocationContent('en', 'Ramp at the side door'),
    space: new EventLocationSpaceContent('en', 'Room 2', 'Hearing loop'),
  };

  it.each(Object.keys(full) as (keyof typeof full)[])(
    '%s allow-list covers exactly the fields the content model emits',
    (key) => {
      expect([...PUBLIC_CONTENT_FIELDS[key]].sort()).toEqual(Object.keys(full[key].toObject()).sort());
    },
  );

  it('serves every content field today for calendar, series and category', () => {
    const calendar = new Calendar('c1', 'cal');
    calendar.addContent(full.calendar);
    const series = new EventSeries('s1', 'c1', 'series');
    series.addContent(full.series);
    const category = new EventCategory('k1', 'c1');
    category.addContent(full.category);

    expect(toPublicCalendarObject(calendar).content).toEqual({ en: full.calendar.toObject() });
    expect(toPublicSeriesObject(series).content).toEqual({ en: full.series.toObject() });
    expect(toPublicCategoryObject(category).content).toEqual({ en: full.category.toObject() });
  });

  it('serves every content field today for an event and its nested location, space, series, categories', () => {
    const event = new CalendarEvent('e1', 'c1');
    event.addContent(full.event);
    const location = new EventLocation('l1', 'Hall', '1 Main St');
    location.addContent(full.location);
    event.location = location;
    const space = new EventLocationSpace('sp1', 'l1');
    space.addContent(full.space);
    event.space = space;
    const series = new EventSeries('s1', 'c1', 'series');
    series.addContent(full.series);
    event.series = series;
    const category = new EventCategory('k1', 'c1');
    category.addContent(full.category);
    event.categories = [category];

    const result = toPublicEventObject(event.toObject());

    expect(result.content).toEqual({ en: full.event.toObject() });
    expect(result.location?.content).toEqual({ en: full.location.toObject() });
    expect(result.space?.content).toEqual({ en: full.space.toObject() });
    expect(result.series?.content).toEqual({ en: full.series.toObject() });
    expect(result.categories[0].content).toEqual({ en: full.category.toObject() });
  });

  it('drops a content key the allow-list does not name, at every level', () => {
    const extra = { secretNote: 'internal' };
    const calendarObj = { id: 'c1', content: { en: { ...full.calendar.toObject(), ...extra } } };
    const seriesObj = { id: 's1', content: { en: { ...full.series.toObject(), ...extra } } };
    const categoryObj = { id: 'k1', content: { en: { ...full.category.toObject(), ...extra } } };
    const eventObj = {
      id: 'e1',
      repostStatus: 'none',
      schedules: [],
      content: { en: { ...full.event.toObject(), ...extra } },
      location: { name: 'Hall', content: { en: { ...full.location.toObject(), ...extra } } },
      space: { content: { en: { ...full.space.toObject(), ...extra } } },
      series: seriesObj,
      categories: [categoryObj],
    };

    const event = toPublicEventObject(eventObj);
    const rows = [
      toPublicCalendarObject(calendarObj).content.en,
      toPublicSeriesObject(seriesObj).content.en,
      toPublicCategoryObject(categoryObj).content.en,
      event.content.en,
      event.location.content.en,
      event.space.content.en,
      event.series.content.en,
      event.categories[0].content.en,
    ];
    for (const row of rows) {
      expect(row).not.toHaveProperty('secretNote');
      expect(row).toHaveProperty('language', 'en');
    }
  });
});
