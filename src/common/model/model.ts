// I would like to make this abstract, but you can't declare static abstract methods in typescript
class Model {
    toObject(): Record<string, any> { return {}; }
    static fromObject(object: Record<string,any>): Model { return new Model(); }
};

class PrimaryModel extends Model {
    id: string = '';

    constructor(id?: string) {
        super();
        this.id = id ?? '';
    };
};

export { Model, PrimaryModel };