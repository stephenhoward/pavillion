import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';

import { ActivityPubMessage, CreateMessage, UpdateMessage, DeleteMessage, FollowMessage, AnnounceMessage, UndoMessage } from '@/common/model/message/actions';
import db from '@/server/common/entity/db';
import { event_activity } from '@/common/model/events';
import { AccountEntity } from '@/server/common/entity/account';

// TODO: should incoming messages be stored somewhere other than an RDB?
class ActivityPubMessageEntity extends Model {
    
    @PrimaryKey
    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    declare id: string;

    @Column({ type: DataType.STRING })
    declare type: string;

    @Column({ type: DataType.DATE })
    declare message_time: Date;

    @Column({ type: DataType.JSON })
    declare message: object;

    @ForeignKey(() => AccountEntity)
    @Column({ type: DataType.STRING })
    declare account_id: string;

    @Column({ type: DataType.DATE })
    declare processed_time: Date;

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;

    toModel(): ActivityPubMessage {

        let builder;
        switch( this.type ) {
            case 'Create':
                builder = (object: any) => CreateMessage.fromObject(object);
                break;
            case 'Update':
                builder = (object: any) => UpdateMessage.fromObject(object);
                break;
            case 'Delete':
                builder = (object: any) => DeleteMessage.fromObject(object);
                break;
            case 'Follow':
                builder = (object: any) => FollowMessage.fromObject(object);
                break;
            case 'Announce':
                builder = (object: any) => AnnounceMessage.fromObject(object);
                break;
            case 'Undo':
                builder = (object: any) => UndoMessage.fromObject(object);
                break;
        }

        if ( ! builder ) {
            throw new Error('Invalid message type: "' + this.type + '"');
        }

        return builder( this.message );
    }
}

@Table({ tableName: 'ap_inbox'})
class ActivityPubInboxMessageEntity extends ActivityPubMessageEntity {
}

@Table({ tableName: 'ap_outbox'})
class ActivityPubOutboxMessageEntity extends ActivityPubMessageEntity {
}

@Table({ tableName: 'ap_follow'})
class FollowedAccountEntity extends Model {

    @Column({ type: DataType.STRING })
    declare remoteAccountId: string;

    @ForeignKey(() => AccountEntity)
    @Column({ type: DataType.STRING })
    declare account_id: string;

    @Column({ type: DataType.STRING })
    declare direction: 'following' | 'follower';

    @BelongsTo(() => AccountEntity)
    declare account: AccountEntity;
}

@Table({ tableName: 'ap_shared_event'})
class SharedEventEntity extends Model {

    @Column({ type: DataType.STRING })
    declare event_id: string;

    @Column({ type: DataType.STRING })
    declare account_id: string;
}

@Table({ tableName: 'ap_event_activity'})
class EventActivityEntity extends Model {

    @Column({ type: DataType.STRING })
    declare event_id: string;

    // TODO: Make this a proper enum? Or convert from enum in model to string in entity
    @Column({ type: DataType.STRING })
    declare type: event_activity;

    @Column({ type: DataType.STRING })
    declare remote_account_id: string;
}

db.addModels([ActivityPubInboxMessageEntity, ActivityPubOutboxMessageEntity, FollowedAccountEntity, SharedEventEntity, EventActivityEntity]);

export {
    ActivityPubMessageEntity,
    ActivityPubInboxMessageEntity,
    ActivityPubOutboxMessageEntity,
    FollowedAccountEntity,
    SharedEventEntity,
    EventActivityEntity
};