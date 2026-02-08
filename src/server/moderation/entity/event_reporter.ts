import {
  Model,
  Column,
  Table,
  DataType,
  PrimaryKey,
  CreatedAt,
} from 'sequelize-typescript';

import db from '@/server/common/entity/db';

/**
 * Database entity for tracking which reporters have reported which events.
 * Used for duplicate report prevention. The unique constraint on
 * (event_id, reporter_identifier) ensures one report per reporter per event.
 */
@Table({
  tableName: 'event_reporter',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      unique: true,
      fields: ['event_id', 'reporter_identifier'],
      name: 'unique_event_reporter',
    },
  ],
})
class EventReporterEntity extends Model {

  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare event_id: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare reporter_identifier: string;

  @Column({ type: DataType.UUID, allowNull: false })
  declare report_id: string;

  @CreatedAt
  @Column({ type: DataType.DATE })
  declare created_at: Date;

  /**
   * Converts the entity to a plain object representation.
   *
   * @returns Plain object with camelCase property names
   */
  toModel(): Record<string, any> {
    return {
      id: this.id,
      eventId: this.event_id,
      reporterIdentifier: this.reporter_identifier,
      reportId: this.report_id,
      createdAt: this.created_at,
    };
  }

  /**
   * Creates an EventReporterEntity from a plain object.
   *
   * @param data - Object with camelCase property names
   * @returns EventReporterEntity instance
   */
  static fromModel(data: {
    id?: string;
    eventId: string;
    reporterIdentifier: string;
    reportId: string;
  }): EventReporterEntity {
    return EventReporterEntity.build({
      id: data.id,
      event_id: data.eventId,
      reporter_identifier: data.reporterIdentifier,
      report_id: data.reportId,
    });
  }
}

db.addModels([EventReporterEntity]);

export { EventReporterEntity };
