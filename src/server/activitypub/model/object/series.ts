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

  /**
   * Serializes this series as a standard ActivityPub object with AS properties
   * and pavillion:* prefixed extensions for federation.
   */
  toActivityPubObject(): Record<string, any> {
    const contentLanguages = Object.keys(this.content).filter(
      lang => this.content[lang] && this.content[lang].name,
    );

    // Determine primary language
    const primaryLanguage = this.content['en']?.name
      ? 'en'
      : contentLanguages[0] || 'en';

    const name = this.content[primaryLanguage]?.name || 'Untitled Series';

    const result: Record<string, any> = {
      type: this.type,
      id: this.id,
      attributedTo: this.attributedTo,
      name,
    };

    // nameMap: only when 2+ languages have content
    if (contentLanguages.length >= 2) {
      const nameMap: Record<string, string> = {};
      for (const lang of contentLanguages) {
        nameMap[lang] = this.content[lang].name;
      }
      result.nameMap = nameMap;
    }

    // pavillion:content extension for full multilingual data
    result['pavillion:content'] = this.content;

    return result;
  }
}

export { SeriesObject };
