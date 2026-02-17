import { Model, Table, Column, PrimaryKey, ForeignKey, DataType, CreatedAt } from 'sequelize-typescript';
import { ComplimentaryGrant } from '@/common/model/complimentary_grant';
import { AccountEntity } from '@/server/common/entity/account';
import db from '@/server/common/entity/db';

/**
 * Database entity for complimentary grants.
 * Represents a grant that gives an account free access to gated subscription features.
 * Uses soft-delete pattern: revoked_at and revoked_by columns track revocation.
 */
@Table({
  tableName: 'complimentary_grant',
  // createdAt is managed automatically; updatedAt is not used for this entity
  createdAt: 'created_at',
  updatedAt: false,
})
class ComplimentaryGrantEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'account_id',
  })
  declare account_id: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'expires_at',
  })
  declare expires_at: Date | null;

  @Column({
    type: DataType.STRING(500),
    allowNull: true,
    field: 'reason',
  })
  declare reason: string | null;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'granted_by',
  })
  declare granted_by: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'revoked_at',
  })
  declare revoked_at: Date | null;

  @Column({
    type: DataType.UUID,
    allowNull: true,
    field: 'revoked_by',
  })
  declare revoked_by: string | null;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
    field: 'created_at',
  })
  declare created_at: Date;

  /**
   * Convert entity to domain model.
   *
   * @returns {ComplimentaryGrant} Domain model instance
   */
  toModel(): ComplimentaryGrant {
    const grant = new ComplimentaryGrant(this.id);
    grant.accountId = this.account_id;
    grant.expiresAt = this.expires_at;
    grant.reason = this.reason;
    grant.grantedBy = this.granted_by;
    grant.revokedAt = this.revoked_at;
    grant.revokedBy = this.revoked_by;
    grant.createdAt = this.created_at;
    return grant;
  }

  /**
   * Create entity from domain model.
   *
   * @param {ComplimentaryGrant} grant - Domain model instance
   * @returns {ComplimentaryGrantEntity} Entity instance
   */
  static fromModel(grant: ComplimentaryGrant): ComplimentaryGrantEntity {
    return ComplimentaryGrantEntity.build({
      id: grant.id,
      account_id: grant.accountId,
      expires_at: grant.expiresAt,
      reason: grant.reason,
      granted_by: grant.grantedBy,
      revoked_at: grant.revokedAt,
      revoked_by: grant.revokedBy,
    });
  }
}

db.addModels([ComplimentaryGrantEntity]);

export { ComplimentaryGrantEntity };
