import {
  Model,
  Column,
  Table,
  DataType,
  PrimaryKey,
  ForeignKey,
  Index,
} from 'sequelize-typescript';

import { BlockedInstance } from '@/common/model/blocked_instance';
import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * Database entity for blocked ActivityPub instances.
 * Tracks which domains are blocked from federating with this instance,
 * including who blocked them and why.
 */
@Table({
  tableName: 'blocked_instance',
  timestamps: false,
  underscored: true,
})
class BlockedInstanceEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Index({ unique: true })
  @Column({ type: DataType.STRING, allowNull: false })
  declare domain: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare reason: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare blocked_at: Date;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID, allowNull: false })
  declare blocked_by: string;

  /**
   * Converts the entity to a BlockedInstance domain model.
   *
   * @returns BlockedInstance domain model instance
   */
  toModel(): BlockedInstance {
    const blockedInstance = new BlockedInstance(this.id);
    blockedInstance.domain = this.domain;
    blockedInstance.reason = this.reason;
    blockedInstance.blockedAt = this.blocked_at;
    blockedInstance.blockedBy = this.blocked_by;
    return blockedInstance;
  }

  /**
   * Creates a BlockedInstanceEntity from a BlockedInstance domain model.
   *
   * @param blockedInstance - BlockedInstance domain model to convert
   * @returns BlockedInstanceEntity instance
   */
  static fromModel(blockedInstance: BlockedInstance): BlockedInstanceEntity {
    return BlockedInstanceEntity.build({
      id: blockedInstance.id,
      domain: blockedInstance.domain,
      reason: blockedInstance.reason,
      blocked_at: blockedInstance.blockedAt,
      blocked_by: blockedInstance.blockedBy,
    });
  }
}

db.addModels([BlockedInstanceEntity]);

export { BlockedInstanceEntity };
