import { Model, Table, Column, PrimaryKey, ForeignKey, DataType } from 'sequelize-typescript';
import { FundingEvent } from '@/common/model/funding-plan';
import { FundingPlanEntity } from './funding_plan';
import db from '@/server/common/entity/db';

@Table({ tableName: 'funding_event' })
class FundingEventEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  /**
   * NULL for provider events that arrive with no matching local plan. The row
   * is still recorded so provider_event_id deduplication stops provider retries.
   */
  @ForeignKey(() => FundingPlanEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  declare funding_plan_id: string | null;

  @Column({ type: DataType.STRING })
  declare event_type: string;

  @Column({ type: DataType.STRING })
  declare provider_event_id: string;

  /**
   * Minimal JSON summary of the provider event.
   *
   * Data minimization (DEC-004): never store the raw provider event graph
   * here. It carries customer, payment-method and billing-address objects
   * that Pavillion has no reason to retain. FundingService builds the summary
   * that gets written — see its summarizeProviderEvent.
   *
   * This constrains new writes only. Rows written before minimization landed
   * still hold complete Stripe event objects, so an instance's existing data
   * is not covered by the rule above. Removing this column and backfilling
   * away the residue are both pending a retention policy.
   */
  @Column({ type: DataType.JSON })
  declare payload: string; // JSON string

  @Column({ type: DataType.DATE, allowNull: true })
  declare processed_at: Date | null;

  /**
   * Convert entity to domain model
   */
  toModel(): FundingEvent {
    const event = new FundingEvent(this.id);
    event.fundingPlanId = this.funding_plan_id;
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
      funding_plan_id: event.fundingPlanId,
      event_type: event.eventType,
      provider_event_id: event.providerEventId,
      payload: event.payload,
      processed_at: event.processedAt,
    });
  }
}

db.addModels([FundingEventEntity]);

export { FundingEventEntity };
