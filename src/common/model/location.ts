import { PrimaryModel } from './model';

class EventLocation extends PrimaryModel {
    id: string = '';
    name: string = '';
    address: string = '';
    city: string = '';
    state: string = '';
    postalCode: string = '';
    country: string = '';

    constructor(id?: string, name?: string, address?: string, city?: string, state?: string, postalCode?: string, country?: string) {
        super();
        this.id=id ?? '';
        this.name = name ?? '';
        this.address = address ?? '';
        this.city = city ?? '';
        this.state = state ?? '';
        this.postalCode = postalCode ?? '';
        this.country = country ?? '';
    }

    static fromObject(obj: Record<string, any>): EventLocation {
        return new EventLocation(obj.name, obj.address, obj.city, obj.state, obj.postalCode);
    }

    toObject(): Record<string, any> {
        return {
            name: this.name,
            address: this.address,
            city: this.city,
            state: this.state,
            postalCode: this.postalCode,
            country: this.country
        };
    }
};

export { EventLocation };