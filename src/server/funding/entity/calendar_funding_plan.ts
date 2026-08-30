import { Model, Table, Column, PrimaryKey, ForeignKey, BelongsTo, DataType, CreatedAt } from 'sequelize-typescript';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { FundingPlanEntity } from './funding_plan';
import db from '@/server/common/entity/db';

/**
 * Database entity for calendar funding plan allocations.
 * Represents which calendars are covered by an account's funding plan.
 * Server-only junction table — intentionally omits toModel/fromModel as there
 * is no corresponding common model. Data is accessed directly via entity properties.
 *
 * end_time semantics:
 *   NULL = currently active allocation
 *   future date = covered through that date
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
    {
      // A calendar belongs to at most one funding plan at a time. The index
      // above only stops one plan holding the same calendar twice; this one
      // carries the domain invariant, and subsumes it.
      //
      // Both are kept. The narrower index costs little and stays meaningful if
      // the product ever admits split coverage, whereas dropping it would make
      // that a schema migration rather than a decision.
      //
      // Enforceable only because every path that ends coverage now writes
      // end_time: allocation removal, cancel(immediate), and the provider's
      // deletion event. A path that ends coverage without closing its rows
      // would leave them open forever and collide here the next time the
      // calendar is bought.
      unique: true,
      fields: ['calendar_id'],
      where: { end_time: null },
      name: 'idx_calendar_subscription_one_open_per_calendar',
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
