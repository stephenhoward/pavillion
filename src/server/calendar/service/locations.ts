import { v4 as uuidv4 } from 'uuid';
import config from 'config';

import { Account } from '@/common/model/account';
import { EventLocation } from '@/common/model/location';
import { LocationEntity } from '@/server/calendar/entity/location';

class LocationService {
  static async findLocation(account: Account, location: EventLocation): Promise<EventLocation|null> {

    if ( location.id ) {
      let entity = await LocationEntity.findByPk(location.id);
      if ( entity && entity.account_id === account.id ) {
        return entity.toModel();
      }
    }
    else {
      let entity = await LocationEntity.findOne({
        where: {
          account_id: account.id,
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

  static generateLocationUrl(account: Account): string {
    const domain = account.domain || config.get('domain');
    return 'https://' + domain + '/places/' + uuidv4();
  }

  static async createLocation(account: Account, location: EventLocation): Promise<EventLocation> {
    const entity = LocationEntity.fromModel(location);
    entity.id = LocationService.generateLocationUrl(account);
    entity.account_id = account.id;
    await entity.save();
    return entity.toModel();
  }

  static async findOrCreateLocation(account: Account, locationParams: Record<string,any>): Promise<EventLocation> {
    let location = await LocationService.findLocation(account, EventLocation.fromObject(locationParams));
    if ( ! location ) {
      location = await LocationService.createLocation(account, EventLocation.fromObject(locationParams));
    }
    return location;
  }
}

export default LocationService;
