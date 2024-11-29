class Model {
    id: string = '';

    toObject(): Record<string, any> { return {}; }
    static fromObject(object: Record<string,any>): Model { return new Model(); }
};

export default Model;