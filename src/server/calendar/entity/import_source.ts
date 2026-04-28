import {
  Model,
  Column,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
  PrimaryKey,
  CreatedAt,
  UpdatedAt,
  Index,
  Default,
} from 'sequelize-typescript';

import {
  ImportSource,
  ImportSourceLastStatus,
  ImportSourceVerificationState,
  ImportSourceVerificationType,
} from '@/common/model/import_source';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import db from '@/server/common/entity/db';

/**
 * ImportSourceEntity
 *
 * Sequelize entity mirroring the `import_source` table defined in
 * migration 0026. Stores calendar-level ICS import subscriptions with
 * their verification lifecycle and fetch bookkeeping.
 *
 * No business logic lives here — verification, fetch scheduling, and
 * state transitions are implemented in ImportSourceService. This class
 * is a pure data mapper (entity ↔ common-model conversion only).
 *
 * @see bead pv-1qcp.1.2
 * @see migration 0026_create_import_source.ts
 */
@Table({
  tableName: 'import_source',
  timestamps: true,
  underscored: true,
})
class ImportSourceEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Index({ name: 'idx_import_source_calendar' })
  @Column({ type: DataType.UUID, allowNull: false })
  declare calendar_id: string;

  @Column({ type: DataType.STRING(2048), allowNull: false })
  declare url: string;

  @Default(true)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare enabled: boolean;

  @Column({
    type: DataType.ENUM('dns-txt', 'rel-me'),
    allowNull: true,
  })
  declare verification_type: ImportSourceVerificationType | null;

  @Default('unverified')
  @Column({
    type: DataType.ENUM('unverified', 'pending', 'verified', 'expired'),
    allowNull: false,
  })
  declare verification_state: ImportSourceVerificationState;

  @Column({ type: DataType.STRING, allowNull: true })
  declare verification_token: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare verified_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare verification_expires_at: Date | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare etag: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true })
  declare content_hash: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare last_fetched_at: Date | null;

  @Column({
    type: DataType.ENUM(
      'ok',
      'fetch_error',
      'parse_error',
      'ssrf_blocked',
      'dns_error',
      'rate_limited',
    ),
    allowNull: true,
  })
  declare last_status: ImportSourceLastStatus | null;

  @CreatedAt
  declare created_at: Date;

  @UpdatedAt
  declare updated_at: Date;

  @BelongsTo(() => CalendarEntity, { foreignKey: 'calendar_id', onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  /**
   * Converts the entity to an ImportSource domain model.
   *
   * The verification_token column is intentionally NOT copied onto the
   * model — it is an owner-only secret surfaced through a dedicated API
   * surface (see ImportSourceService) and must not leak via generic
   * list/read responses.
   */
  toModel(): ImportSource {
    const model = new ImportSource(this.id, this.calendar_id, this.url);
    model.enabled = this.enabled;
    model.verificationType = this.verification_type;
    model.verificationState = this.verification_state;
    model.verifiedAt = this.verified_at;
    model.verificationExpiresAt = this.verification_expires_at;
    model.etag = this.etag;
    model.contentHash = this.content_hash;
    model.lastFetchedAt = this.last_fetched_at;
    model.lastStatus = this.last_status;
    model.createdAt = this.created_at ?? null;
    model.updatedAt = this.updated_at ?? null;
    return model;
  }

  /**
   * Creates an ImportSourceEntity from an ImportSource domain model.
   *
   * The verification_token is NOT present on the domain model by design
   * (see toModel comment). Callers that need to persist a newly-issued
   * token must set it directly on the entity after building, or use the
   * service's verification-issue flow which handles token storage.
   */
  static fromModel(model: ImportSource): ImportSourceEntity {
    return ImportSourceEntity.build({
      id: model.id,
      calendar_id: model.calendarId,
      url: model.url,
      enabled: model.enabled,
      verification_type: model.verificationType,
      verification_state: model.verificationState,
      verified_at: model.verifiedAt,
      verification_expires_at: model.verificationExpiresAt,
      etag: model.etag,
      content_hash: model.contentHash,
      last_fetched_at: model.lastFetchedAt,
      last_status: model.lastStatus,
    });
  }
}

db.addModels([ImportSourceEntity]);

export { ImportSourceEntity };
