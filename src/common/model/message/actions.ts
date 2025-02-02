class ActivityPubMessage {
    context: string[] = ['https://www.w3.org/ns/activitystreams'];
    id: string = '';
    type: string = '';
    actor: APActor|string;
    published: Date|null;
    to: string[] = [];
    cc: string[] = [];
    object: APObject|string;

    constructor( actor: APActor|string, object: APObject|string ) {

        this.object = object;
        this.actor = actor;
        this.published = object instanceof APObject ? object.published: null;
    }

    toObject(): Record<string, any> {
        return {
            '@context': this.context,
            id: this.id,
            type: this.type,
            actor: this.actor,
            published: this.published,
            to: this.to,
            cc: this.cc,
            object: this.object instanceof APObject
              ? this.object.toObject()
              : this.object
        };
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
        let object = json.object instanceof Object
          ? APObject.fromObject(json.object)
          : json.object;
        let actor = json.actor instanceof Object
            ? APActor.fromObject(json.actor)
            : json.actor;
        let message = new ActivityPubMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class CreateMessage extends ActivityPubMessage {
    type: string = 'Create';

    constructor( actor: string, object: APObject|string ) {
        super(actor, object);
        this.id = ( object instanceof APObject ? object.id : object ) + '/create';
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
      let object = json.object instanceof Object
        ? APObject.fromObject(json.object)
        : json.object;
      let actor = json.actor instanceof Object
        ? APActor.fromObject(json.actor)
        : json.actor;
      let message = new CreateMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class UpdateMessage extends ActivityPubMessage {
    type: string = 'Update';

    constructor( actor: string, object: APObject|string ) {
        super(actor, object);

        this.id = ( object instanceof APObject ? object.id : object ) + '/update';
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
      let object = json.object instanceof Object
          ? APObject.fromObject(json.object)
          : json.object;
      let actor = json.actor instanceof Object
          ? APActor.fromObject(json.actor)
          : json.actor;
      let message = new UpdateMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class DeleteMessage extends ActivityPubMessage {
    type: string = 'Delete';

    constructor( actor: string, object: APObject|string ) {
        super(actor, object);
        this.id = ( object instanceof APObject ? object.id : object ) + '/delete';
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
      let object = json.object instanceof Object
          ? APObject.fromObject(json.object)
          : json.object;
      let actor = json.actor instanceof Object
          ? APActor.fromObject(json.actor)
          : json.actor;
      let message = new DeleteMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class FollowMessage extends ActivityPubMessage {
    type: string = 'Follow';

    constructor( actor: string, object: APObject|string ) {
        super(actor, object);
        this.id = ( object instanceof APObject ? object.id : object ) + '/follow';
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
        let object = json.object instanceof Object
          ? APObject.fromObject(json.object)
          : json.object;
        let actor = json.actor instanceof Object
          ? APActor.fromObject(json.actor)
          : json.actor;
      let message = new FollowMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class AnnounceMessage extends ActivityPubMessage {
    type: string = 'Announce';

    constructor( actor: string, object: APObject|string ) {
        super(actor, object);
        this.id = ( object instanceof APObject ? object.id : object ) + '/announce';
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
        let object = json.object instanceof Object
          ? APObject.fromObject(json.object)
          : json.object;
        let actor = json.actor instanceof Object
          ? APActor.fromObject(json.actor)
          : json.actor;
      let message = new AnnounceMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class UndoMessage extends ActivityPubMessage {
    type: string = 'Follow';

    constructor( actor: string, object: APObject|string ) {
        super(actor, object);
        this.id = ( object instanceof APObject ? object.id : object ) + '/undo';
    }

    static fromObject( json: Record<string, any> ): CreateMessage {
        let actor = json.actor instanceof Object
            ? APActor.fromObject(json.actor)
            : json.actor;
        let object = json.object instanceof Object
          ? APObject.fromObject(json.object)
          : json.object;
        let message = new FollowMessage(actor, object);
        message.id = json.id;
        message.to = json.to;
        message.cc = json.cc;
        return message;
    }
}

class APActor {
    context: string;
    type: string;
    name: string;

    constructor( context: string, type: string, name: string ) {
        this.context = context;
        this.type = type;
        this.name = name;
    }

    toObject(): Record<string, any> {
        return {
            '@context': this.context,
            type: this.type,
            name: this.name
        };
    }

    static fromObject( json: Record<string, any> ): APActor {
        return new APActor(json.context, json.type, json.name);
    }
}

class APObject {
    id: string;
    type: string;
    published: Date;
    attributedTo: string;
    url: string;

    constructor( id: string, type: string, published: Date, attributedTo: string, url: string ) {
        this.id = id;
        this.type = type;
        this.published = published;
        this.attributedTo = attributedTo;
        this.url = url;
    }

    toObject(): Record<string, any> {
        return {
            id: this.id,
            type: this.type,
            published: this.published,
            attributedTo: this.attributedTo,
            url: this.url
        };
    }

    static fromObject( json: Record<string, any> ): APObject {
        return new APObject(json.id, json.type, json.published, json.attributedTo, json.url);
    }
}

export { ActivityPubMessage, CreateMessage, UpdateMessage, DeleteMessage, FollowMessage, AnnounceMessage, UndoMessage, APObject }
