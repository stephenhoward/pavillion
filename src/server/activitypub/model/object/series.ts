import config from 'config';
import { Calendar } from '@/common/model/calendar';
import { EventSeries } from '@/common/model/event_series';
import { ActivityPubObject } from '@/server/activitypub/model/base';

class SeriesObject extends ActivityPubObject {
  type: string = 'OrderedCollection';
  attributedTo: string;
  content: Record<string, { name: string; description: string }>;

  static seriesUrl(calendar: Calendar, series: EventSeries|string): string {
    let id = typeof series == 'string'
      ? series
      : series.id;

    return id.match('^https?:\/\/')
      ? id
      : 'https://'+config.get('domain')+'/calendars/'+calendar.urlName+'/series/'+id;
  }

  constructor(calendar: Calendar, series: EventSeries) {
    super();
    this.id = SeriesObject.seriesUrl(calendar, series);

    const domain = config.get('domain');
    this.attributedTo = 'https://'+domain+'/calendars/'+calendar.urlName;

    this.content = Object.fromEntries(
      Object.entries(series._content).map(([language, c]) => [
        language,
        { name: c.name, description: c.description },
      ]),
    );
  }
}

export { SeriesObject };
