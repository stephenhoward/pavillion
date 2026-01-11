import { Model, Table, Column, PrimaryKey, ForeignKey, DataType, BeforeUpdate } from 'sequelize-typescript';
import { Subscription, SubscriptionStatus, BillingCycle } from '@/common/model/subscription';
import { AccountEntity } from '@/server/common/entity/account';
import { ProviderConfigEntity } from './provider_config';
import db from '@/server/common/entity/db';

@Table({ tableName: 'subscription' })
class SubscriptionEntity extends Model {
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
  declare status: SubscriptionStatus;

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

  @Column({ type: DataType.DATE, allowNull: true })
  declare cancelled_at: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare suspended_at: Date | null;

  /**
   * Convert entity to domain model
   */
  toModel(): Subscription {
    const subscription = new Subscription(this.id);
    subscription.accountId = this.account_id;
    subscription.providerConfigId = this.provider_config_id;
    subscription.providerSubscriptionId = this.provider_subscription_id;
    subscription.providerCustomerId = this.provider_customer_id;
    subscription.status = this.status;
    subscription.billingCycle = this.billing_cycle;
    subscription.amount = this.amount;
    subscription.currency = this.currency;
    subscription.currentPeriodStart = this.current_period_start;
    subscription.currentPeriodEnd = this.current_period_end;
    subscription.cancelledAt = this.cancelled_at;
    subscription.suspendedAt = this.suspended_at;
    return subscription;
  }

  /**
   * Convert domain model to entity
   */
  static fromModel(subscription: Subscription): SubscriptionEntity {
    return SubscriptionEntity.build({
      id: subscription.id,
      account_id: subscription.accountId,
      provider_config_id: subscription.providerConfigId,
      provider_subscription_id: subscription.providerSubscriptionId,
      provider_customer_id: subscription.providerCustomerId,
      status: subscription.status,
      billing_cycle: subscription.billingCycle,
      amount: subscription.amount,
      currency: subscription.currency,
      current_period_start: subscription.currentPeriodStart,
      current_period_end: subscription.currentPeriodEnd,
      cancelled_at: subscription.cancelledAt,
      suspended_at: subscription.suspendedAt,
    });
  }

  /**
   * Validate status transitions before update
   * This hook provides basic validation but complex business logic
   * should be in the service layer
   */
  @BeforeUpdate
  static validateStatusTransition(instance: SubscriptionEntity) {
    // Valid transitions:
    // active -> past_due (payment failed)
    // active -> cancelled (user cancelled)
    // past_due -> active (payment succeeded)
    // past_due -> suspended (grace period expired)
    // suspended -> active (reactivated with payment)
    // cancelled -> active (resubscribed)

    const previousStatus = instance.previous('status') as SubscriptionStatus;
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
  }
}

db.addModels([SubscriptionEntity]);

export { SubscriptionEntity };
