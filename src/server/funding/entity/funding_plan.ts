import { Model, Table, Column, PrimaryKey, ForeignKey, DataType, BeforeUpdate } from 'sequelize-typescript';
import { FundingPlan } from '@/common/model/funding-plan';
// Types used in decorated signatures must be type-only imports under
// isolatedModules + emitDecoratorMetadata.
import type { FundingPlanStatus, BillingCycle } from '@/common/model/funding-plan';
import { AccountEntity } from '@/server/common/entity/account';
import { ProviderConfigEntity } from './provider_config';
import db from '@/server/common/entity/db';

@Table({ tableName: 'funding_plan' })
class FundingPlanEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => AccountEntity)
  @Column({ type: DataType.UUID })
  declare account_id: string;

  @ForeignKey(() => ProviderConfigEntity)
  @Column({ type: DataType.UUID })
  declare provider_config_id: string;

  @Column({ type: DataType.STRING })
  declare provider_subscription_id: string;

  @Column({ type: DataType.STRING })
  declare provider_customer_id: string;

  @Column({
    type: DataType.ENUM('active', 'past_due', 'suspended', 'cancelled'),
    defaultValue: 'active',
  })
  declare status: FundingPlanStatus;

  @Column({
    type: DataType.ENUM('monthly', 'yearly'),
  })
  declare billing_cycle: BillingCycle;

  @Column({ type: DataType.INTEGER })
  declare amount: number; // in millicents

  @Column({ type: DataType.STRING(3) })
  declare currency: string;

  @Column({ type: DataType.DATE })
  declare current_period_start: Date;

  @Column({ type: DataType.DATE })
  declare current_period_end: Date;

  /**
   * When cancellation was requested. Written only on the transition into
   * status 'cancelled', so it is history, never an access boundary.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare cancelled_at: Date | null;

  /**
   * When a scheduled cancellation takes effect, or null if none is scheduled.
   *
   * Set by a cancel-at-period-end while the plan stays 'active': the customer
   * has paid through this instant and keeps every entitlement until it. Read
   * as an access boundary by FundingService.planAccessExpiry, so the plan stops
   * granting at the boundary even if the provider's final deletion event is
   * lost. Cleared when the plan is resubscribed, for the same reason
   * cancelled_at is.
   */
  @Column({ type: DataType.DATE, allowNull: true })
  declare cancel_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare suspended_at: Date | null;

  /**
   * Convert entity to domain model
   */
  toModel(): FundingPlan {
    const plan = new FundingPlan(this.id);
    plan.accountId = this.account_id;
    plan.providerConfigId = this.provider_config_id;
    plan.providerSubscriptionId = this.provider_subscription_id;
    plan.providerCustomerId = this.provider_customer_id;
    plan.status = this.status;
    plan.billingCycle = this.billing_cycle;
    plan.amount = this.amount;
    plan.currency = this.currency;
    plan.currentPeriodStart = this.current_period_start;
    plan.currentPeriodEnd = this.current_period_end;
    plan.cancelledAt = this.cancelled_at;
    plan.cancelAt = this.cancel_at;
    plan.suspendedAt = this.suspended_at;
    return plan;
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(plan: FundingPlan): FundingPlanEntity {
    return FundingPlanEntity.build({
      id: plan.id,
      account_id: plan.accountId,
      provider_config_id: plan.providerConfigId,
      provider_subscription_id: plan.providerSubscriptionId,
      provider_customer_id: plan.providerCustomerId,
      status: plan.status,
      billing_cycle: plan.billingCycle,
      amount: plan.amount,
      currency: plan.currency,
      current_period_start: plan.currentPeriodStart,
      current_period_end: plan.currentPeriodEnd,
      cancelled_at: plan.cancelledAt,
      cancel_at: plan.cancelAt,
      suspended_at: plan.suspendedAt,
    });
  }

  /**
   * Validate status transitions before update
   * This hook provides basic validation but complex business logic
   * should be in the service layer
   */
  @BeforeUpdate
  static validateStatusTransition(instance: FundingPlanEntity) {
    // Valid transitions:
    // active -> past_due (payment failed)
    // active -> cancelled (user cancelled)
    // past_due -> active (payment succeeded)
    // past_due -> suspended (grace period expired)
    // suspended -> active (reactivated with payment)
    // cancelled -> active (plan restarted)

    const previousStatus = instance.previous('status') as FundingPlanStatus;
    const newStatus = instance.status;

    // Set suspended_at timestamp when transitioning to suspended
    if (newStatus === 'suspended' && previousStatus !== 'suspended') {
      instance.suspended_at = new Date();
    }

    // Set cancelled_at timestamp when transitioning to cancelled
    if (newStatus === 'cancelled' && previousStatus !== 'cancelled') {
      instance.cancelled_at = new Date();
    }

    // Clear suspended_at when reactivating
    if (newStatus === 'active' && previousStatus === 'suspended') {
      instance.suspended_at = null;
    }

    // Clear both cancellation markers when resubscribing. A stale marker on a
    // plan that is active again reads as a lapsed plan to the funding-access
    // check, which would deny a customer who is paying. cancel_at is cleared
    // alongside cancelled_at rather than left behind: it is the marker the
    // access boundary actually reads, so a stale one denies where a stale
    // cancelled_at merely misinforms.
    if (newStatus === 'active' && previousStatus === 'cancelled') {
      instance.cancelled_at = null;
      instance.cancel_at = null;
    }
  }
}

db.addModels([FundingPlanEntity]);

export { FundingPlanEntity };
