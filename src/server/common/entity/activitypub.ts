import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey, HasMany } from 'sequelize-typescript';

import { ActivityPubMessage, CreateMessage, UpdateMessage, DeleteMessage, FollowMessage, AnnounceMessage, UndoMessage } from '@/common/model/message/actions';
import db from '@/server/common/entity/db';
import { event_activity } from '@/common/model/events';
import { AccountEntity } from '@/server/common/entity/account';
import { EventEntity } from '@/server/common/entity/event';

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
        switch( this.type ) {
            case 'Create':
                return CreateMessage.fromObject(this.message);
                break;
            case 'Update':
                return UpdateMessage.fromObject(this.message);
                break;
            case 'Delete':
                return DeleteMessage.fromObject(this.message);
                break;
            case 'Follow':
                return FollowMessage.fromObject(this.message);
                break;
            case 'Announce':
                return AnnounceMessage.fromObject(this.message);
                break;
            case 'Undo':
                return UndoMessage.fromObject(this.message);
                break;
        }

        throw new Error('Invalid message type: "' + this.type + '"');
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

    @ForeignKey(() => EventEntity)
    @Column({ type: DataType.STRING })
    declare event_id: string;

    @Column({ type: DataType.STRING })
    declare account_id: string;

    @BelongsTo(() => EventEntity)
    declare event: EventEntity;
}

@Table({ tableName: 'ap_event_activity'})
class EventActivityEntity extends Model {

    @ForeignKey(() => EventEntity)
    @Column({ type: DataType.STRING })
    declare event_id: string;

    // TODO: Make this a proper enum? Or convert from enum in model to string in entity
    @Column({ type: DataType.STRING })
    declare type: event_activity;

    @Column({ type: DataType.STRING })
    declare remote_account_id: string;

    @BelongsTo(() => EventEntity)
    declare event: EventEntity;
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