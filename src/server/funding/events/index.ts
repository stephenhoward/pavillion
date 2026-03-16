import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';

/**
 * Funding domain event handlers
 *
 * Manages event handlers for funding plan lifecycle events.
 * Events emitted:
 * - funding_plan:created - When a new funding plan is created
 * - funding_plan:cancelled - When a funding plan is cancelled
 * - funding_plan:suspended - When a funding plan is suspended
 * - funding_plan:reactivated - When a suspended funding plan is reactivated
 * - funding_plan:payment_failed - When a payment fails
 */
export default class FundingEventHandlers implements DomainEventHandlers {
  install(eventBus: EventEmitter): void {
    // Register event handlers for funding plan lifecycle events

    eventBus.on('funding_plan:created', (data: { fundingPlan: any }) => {
      console.log(`[FundingPlan] Created: ${data.fundingPlan.id}`);
      // Future: Send confirmation email, update analytics, etc.
    });

    eventBus.on('funding_plan:cancelled', (data: { fundingPlan: any; immediate: boolean }) => {
      console.log(
        `[FundingPlan] Cancelled: ${data.fundingPlan.id} (immediate: ${data.immediate})`,
      );
      // Future: Send cancellation confirmation email
    });

    eventBus.on('funding_plan:suspended', (data: { fundingPlan: any }) => {
      console.log(`[FundingPlan] Suspended: ${data.fundingPlan.id}`);
      // Future: Send suspension notification email
    });

    eventBus.on('funding_plan:reactivated', (data: { fundingPlan: any }) => {
      console.log(`[FundingPlan] Reactivated: ${data.fundingPlan.id}`);
      // Future: Send reactivation confirmation email
    });

    eventBus.on('funding_plan:payment_failed', (data: { fundingPlan: any }) => {
      console.log(`[FundingPlan] Payment failed: ${data.fundingPlan.id}`);
      // Future: Send payment failure notification email
    });
  }
}
