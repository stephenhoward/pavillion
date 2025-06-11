import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';
import { Media, MediaStatus } from '@/common/model/media';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import db from '@/server/common/entity/db';

@Table({ tableName: 'media' })
export class MediaEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    allowNull: false,
  })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare calendar_id: string;

  @Column({
    type: DataType.STRING(64),
    allowNull: false,
    unique: true,
  })
  declare sha256: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare original_filename: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare mime_type: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare file_size: number;

  @Column({
    type: DataType.ENUM('pending', 'approved', 'failed', 'deleted'),
    allowNull: false,
    defaultValue: 'pending',
  })
  declare status: MediaStatus;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare uploaded_at: Date;

  @UpdatedAt
  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare processed_at: Date | null;

  @BelongsTo(() => CalendarEntity)
  declare calendar: CalendarEntity;

  /**
   * Converts the entity to a domain model
   */
  toModel(): Media {
    const media = new Media(
      this.id,
      this.calendar_id,
      this.sha256,
      this.original_filename,
      this.mime_type,
      this.file_size,
      this.status,
    );

    return media;
  }

  /**
   * Creates an entity from a domain model
   */
  static fromModel(media: Media): MediaEntity {
    return MediaEntity.build({
      id: media.id,
      calendar_id: media.calendarId,
      sha256: media.sha256,
      original_filename: media.originalFilename,
      mime_type: media.mimeType,
      file_size: media.fileSize,
      status: media.status,
    });
  }
}

// Register the models with the database
db.addModels([MediaEntity]);
