import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';

import { event_activity } from '@/common/model/events';
import db from '@/server/common/entity/db';
import { AccountEntity } from '@/server/common/entity/account';
import { ActivityPubActivity } from '@/server/activitypub/model/base';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import DeleteActivity from '@/server/activitypub/model/action/delete';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import FollowActivity from '@/server/activitypub/model/action/follow';
import UndoActivity from '@/server/activitypub/model/action/undo';

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

    toModel(): ActivityPubActivity {

        let builder;
        switch( this.type ) {
            case 'Create':
                builder = (object: any) => CreateActivity.fromObject(object);
                break;
            case 'Update':
                builder = (object: any) => UpdateActivity.fromObject(object);
                break;
            case 'Delete':
                builder = (object: any) => DeleteActivity.fromObject(object);
                break;
            case 'Follow':
                builder = (object: any) => FollowActivity.fromObject(object);
                break;
            case 'Announce':
                builder = (object: any) => AnnounceActivity.fromObject(object);
                break;
            case 'Undo':
                builder = (object: any) => UndoActivity.fromObject(object);
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

    @PrimaryKey
    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    declare id: string;

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

    @PrimaryKey
    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    declare id: string;

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