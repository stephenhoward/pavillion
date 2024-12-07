import { v4 as uuidv4 } from 'uuid';
import { Account } from '../../../common/model/account';
import { EventLocation } from '../../../common/model/location';
import { LocationEntity } from '../../common/entity/location';

class LocationService {
    static async findLocation(account: Account, location: EventLocation): Promise<EventLocation|null> {

        if ( location.id ) {
            let entity = await LocationEntity.findByPk(location.id);
            if ( entity && entity.accountId === account.id ) {
                return entity.toModel();
            }
        }
        else {
            let conditions = location.toObject();
            conditions['account_id'] = account.id;
            let entity = await LocationEntity.findOne({
                where: conditions
            });
            if ( entity ) {
                return entity.toModel();
            }
        }
        return null;
    }

    static async createLocation(account: Account, location: EventLocation): Promise<EventLocation> {
        const entity = LocationEntity.fromModel(location);
        entity.id = uuidv4();
        entity.accountId = account.id;
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