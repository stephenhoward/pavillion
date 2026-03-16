import { Model, Table, Column, PrimaryKey, ForeignKey, DataType } from 'sequelize-typescript';
import { FundingEvent } from '@/common/model/funding-plan';
import { FundingPlanEntity } from './funding_plan';
import db from '@/server/common/entity/db';

@Table({ tableName: 'funding_event' })
class FundingEventEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => FundingPlanEntity)
  @Column({ type: DataType.UUID })
  declare funding_plan_id: string;

  @Column({ type: DataType.STRING })
  declare event_type: string;

  @Column({ type: DataType.STRING })
  declare provider_event_id: string;

  @Column({ type: DataType.JSON })
  declare payload: string; // JSON string

  @Column({ type: DataType.DATE, allowNull: true })
  declare processed_at: Date | null;

  /**
   * Convert entity to domain model
   */
  toModel(): FundingEvent {
    const event = new FundingEvent(this.id);
    event.subscriptionId = this.funding_plan_id;
    event.eventType = this.event_type;
    event.providerEventId = this.provider_event_id;
    event.payload = typeof this.payload === 'string' ? this.payload : JSON.stringify(this.payload);
    event.processedAt = this.processed_at;
    return event;
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(event: FundingEvent): FundingEventEntity {
    return FundingEventEntity.build({
      id: event.id,
      funding_plan_id: event.subscriptionId,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      payload: event.payload,
      processed_at: event.processedAt,
    });
  }
}

db.addModels([FundingEventEntity]);

export { FundingEventEntity };
