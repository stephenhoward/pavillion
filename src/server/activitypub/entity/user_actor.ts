import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, CreatedAt, UpdatedAt, Index } from 'sequelize-typescript';

import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * UserActor model for representing a user's ActivityPub Person actor.
 * Supports both local actors (linked to an account) and remote actors
 * (discovered via federation).
 */
export interface UserActor {
  id: string;
  actorType: 'local' | 'remote';
  accountId: string | null;
  actorUri: string;
  remoteUsername: string | null;
  remoteDomain: string | null;
  publicKey: string | null;
  privateKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Table({ tableName: 'user_actor' })
class UserActorEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({ type: DataType.STRING(10), allowNull: false, defaultValue: 'local' })
  declare actor_type: 'local' | 'remote';

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: true, unique: true })
  declare account_id: string | null;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  declare actor_uri: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare remote_username: string | null;

  @Index
  @Column({ type: DataType.STRING, allowNull: true })
  declare remote_domain: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare public_key: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare private_key: string | null;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @BelongsTo(() => AccountEntity, { onDelete: 'CASCADE' })
  declare account: AccountEntity;

  /**
   * Converts the entity to a plain UserActor object
   */
  toModel(): UserActor {
    return {
      id: this.id,
      actorType: this.actor_type,
      accountId: this.account_id ?? null,
      actorUri: this.actor_uri,
      remoteUsername: this.remote_username ?? null,
      remoteDomain: this.remote_domain ?? null,
      publicKey: this.public_key ?? null,
      privateKey: this.private_key ?? null,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a UserActorEntity from a UserActor model
   */
  static fromModel(userActor: UserActor): UserActorEntity {
    return UserActorEntity.build({
      id: userActor.id,
      actor_type: userActor.actorType,
      account_id: userActor.accountId,
      actor_uri: userActor.actorUri,
      remote_username: userActor.remoteUsername,
      remote_domain: userActor.remoteDomain,
      public_key: userActor.publicKey,
      private_key: userActor.privateKey,
    });
  }
}

db.addModels([UserActorEntity]);

export { UserActorEntity };
