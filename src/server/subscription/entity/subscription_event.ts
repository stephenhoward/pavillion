import { Model, Table, Column, PrimaryKey, ForeignKey, DataType } from 'sequelize-typescript';
import { SubscriptionEvent } from '@/common/model/subscription';
import { SubscriptionEntity } from './subscription';
import db from '@/server/common/entity/db';

@Table({ tableName: 'subscription_event' })
class SubscriptionEventEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => SubscriptionEntity)
  @Column({ type: DataType.UUID })
  declare subscription_id: string;

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
  toModel(): SubscriptionEvent {
    const event = new SubscriptionEvent(this.id);
    event.subscriptionId = this.subscription_id;
    event.eventType = this.event_type;
    event.providerEventId = this.provider_event_id;
    event.payload = typeof this.payload === 'string' ? this.payload : JSON.stringify(this.payload);
    event.processedAt = this.processed_at;
    return event;
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(event: SubscriptionEvent): SubscriptionEventEntity {
    return SubscriptionEventEntity.build({
      id: event.id,
      subscription_id: event.subscriptionId,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      payload: event.payload,
      processed_at: event.processedAt,
    });
  }
}

db.addModels([SubscriptionEventEntity]);

export { SubscriptionEventEntity };
