import { Model, Column, Table, BelongsTo, ForeignKey, DataType, PrimaryKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { CalendarEntity } from '@/server/calendar/entity/calendar';
import db from '@/server/common/entity/db';

/**
 * CalendarActor model for representing a calendar's ActivityPub Group actor
 */
export interface CalendarActor {
  id: string;
  calendarId: string;
  actorUri: string;
  publicKey: string;
  privateKey: string;
  createdAt: Date;
  updatedAt: Date;
}

@Table({ tableName: 'calendar_actor' })
class CalendarActorEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => CalendarEntity)
  @Column({ type: DataType.UUID, allowNull: false, unique: true })
  declare calendar_id: string;

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

  @BelongsTo(() => CalendarEntity, { onDelete: 'CASCADE' })
  declare calendar: CalendarEntity;

  /**
   * Converts the entity to a plain CalendarActor object
   */
  toModel(): CalendarActor {
    return {
      id: this.id,
      calendarId: this.calendar_id,
      actorUri: this.actor_uri,
      publicKey: this.public_key,
      privateKey: this.private_key,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Creates a CalendarActorEntity from a CalendarActor model
   */
  static fromModel(calendarActor: CalendarActor): CalendarActorEntity {
    return CalendarActorEntity.build({
      id: calendarActor.id,
      calendar_id: calendarActor.calendarId,
      actor_uri: calendarActor.actorUri,
      public_key: calendarActor.publicKey,
      private_key: calendarActor.privateKey,
    });
  }
}

db.addModels([CalendarActorEntity]);

export { CalendarActorEntity };
