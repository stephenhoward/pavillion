import { Model, Table, Column, PrimaryKey, ForeignKey, BelongsTo, DataType, CreatedAt } from 'sequelize-typescript';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { FundingPlanEntity } from './funding_plan';
import db from '@/server/common/entity/db';

/**
 * Database entity for calendar subscriptions.
 * Represents the allocation of subscription funds to a specific calendar.
 * Server-only junction table — intentionally omits toModel/fromModel as there
 * is no corresponding common model. Data is accessed directly via entity properties.
 *
 * end_time semantics:
 *   NULL = currently active allocation
 *   future date = funded through that date
 *   past date = allocation has ended
 */
@Table({
  tableName: 'calendar_subscription',
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    {
      unique: true,
      fields: ['funding_plan_id', 'calendar_id'],
      where: { end_time: null },
      name: 'idx_calendar_subscription_unique_active',
    },
  ],
})
class CalendarFundingPlanEntity extends Model {
  @PrimaryKey
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => FundingPlanEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'funding_plan_id',
  })
  declare funding_plan_id: string;

  @BelongsTo(() => FundingPlanEntity)
  declare fundingPlan: FundingPlanEntity;

  @ForeignKey(() => CalendarEntity)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'calendar_id',
  })
  declare calendar_id: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'amount',
  })
  declare amount: number; // in millicents

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'end_time',
  })
  declare end_time: Date | null;

  @CreatedAt
  @Column({
    type: DataType.DATE,
    allowNull: false,
    field: 'created_at',
  })
  declare created_at: Date;
}

db.addModels([CalendarFundingPlanEntity]);

export { CalendarFundingPlanEntity };
