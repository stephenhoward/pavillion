import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * UserActor model for representing a user's ActivityPub Person actor
 */
export interface UserActor {
  id: string;
  accountId: string;
  actorUri: string;
  publicKey: string;
  privateKey: string;
  createdAt: Date;
  updatedAt: Date;
}

@Table({ tableName: 'user_actor' })
class UserActorEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  declare account_id: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  declare actor_uri: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare public_key: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare private_key: string;

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
      accountId: this.account_id,
      actorUri: this.actor_uri,
      publicKey: this.public_key,
      privateKey: this.private_key,
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
      account_id: userActor.accountId,
      actor_uri: userActor.actorUri,
      public_key: userActor.publicKey,
      private_key: userActor.privateKey,
    });
  }
}

db.addModels([UserActorEntity]);

export { UserActorEntity };
