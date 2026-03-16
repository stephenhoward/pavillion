import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';

/**
 * Funding domain event handlers
 *
 * Manages event handlers for funding plan lifecycle events.
 * Events emitted:
 * - funding_plan:created - When a new subscription is created
 * - funding_plan:cancelled - When a subscription is cancelled
 * - funding_plan:suspended - When a subscription is suspended
 * - funding_plan:reactivated - When a suspended subscription is reactivated
 * - funding_plan:payment_failed - When a payment fails
 */
export default class FundingEventHandlers implements DomainEventHandlers {
  install(eventBus: EventEmitter): void {
    // Register event handlers for subscription lifecycle events

    eventBus.on('funding_plan:created', (data: { funding_plan: any }) => {
      console.log(`[FundingPlan] Created: ${data.subscription.id}`);
      // Future: Send confirmation email, update analytics, etc.
    });

    eventBus.on('funding_plan:cancelled', (data: { funding_plan: any; immediate: boolean }) => {
      console.log(
        `[FundingPlan] Cancelled: ${data.subscription.id} (immediate: ${data.immediate})`,
      );
      // Future: Send cancellation confirmation email
    });

    eventBus.on('funding_plan:suspended', (data: { funding_plan: any }) => {
      console.log(`[FundingPlan] Suspended: ${data.subscription.id}`);
      // Future: Send suspension notification email
    });

    eventBus.on('funding_plan:reactivated', (data: { funding_plan: any }) => {
      console.log(`[FundingPlan] Reactivated: ${data.subscription.id}`);
      // Future: Send reactivation confirmation email
    });

    eventBus.on('funding_plan:payment_failed', (data: { funding_plan: any }) => {
      console.log(`[FundingPlan] Payment failed: ${data.subscription.id}`);
      // Future: Send payment failure notification email
    });
  }
}
