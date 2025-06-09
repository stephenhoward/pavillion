import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Calendar } from '@/common/model/calendar';
import { EventLocation } from '@/common/model/location';
import { LocationEntity } from '@/server/calendar/entity/location';

export default class LocationService {
  async findLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation|null> {

    if ( location.id ) {
      let entity = await LocationEntity.findByPk(location.id);
      if ( entity && entity.calendar_id === calendar.id ) {
        return entity.toModel();
      }
    }
    else {
      let entity = await LocationEntity.findOne({
        where: {
          calendar_id: calendar.id,
          name: location.name,
          address: location.address,
          city: location.city,
          state: location.state,
          postal_code: location.postalCode,
          country: location.country,
        },
      });
      if ( entity ) {
        return entity.toModel();
      }
    }
    return null;
  }

  generateLocationUrl(): string {
    const domain = config.get('domain');
    return 'https://' + domain + '/places/' + uuidv4();
  }

  async createLocation(calendar: Calendar, location: EventLocation): Promise<EventLocation> {
    const entity = LocationEntity.fromModel(location);
    entity.id = this.generateLocationUrl();
    entity.calendar_id = calendar.id;
    await entity.save();
    return entity.toModel();
  }

  async findOrCreateLocation(calendar: Calendar, locationParams: Record<string,any>): Promise<EventLocation> {
    let location = await this.findLocation(calendar, EventLocation.fromObject(locationParams));
    if ( ! location ) {
      location = await this.createLocation(calendar, EventLocation.fromObject(locationParams));
    }
    return location;
  }
}
