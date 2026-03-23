import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('funding');

/**
 * Funding domain event handlers
 *
 * Manages event handlers for funding plan lifecycle events.
 * Events emitted:
 * - funding:plan:created - When a new funding plan is created
 * - funding:plan:cancelled - When a funding plan is cancelled
 * - funding:plan:suspended - When a funding plan is suspended
 * - funding:plan:reactivated - When a suspended funding plan is reactivated
 * - funding:plan:payment_failed - When a payment fails
 */
export default class FundingEventHandlers implements DomainEventHandlers {
  install(eventBus: EventEmitter): void {
    // Register event handlers for funding plan lifecycle events

    eventBus.on('funding:plan:created', (data: { fundingPlan: any }) => {
      logger.info({ id: data.fundingPlan.id }, 'Funding plan created');
      // Future: Send confirmation email, update analytics, etc.
    });

    eventBus.on('funding:plan:cancelled', (data: { fundingPlan: any; immediate: boolean }) => {
      logger.info({ id: data.fundingPlan.id, immediate: data.immediate }, 'Funding plan cancelled');
      // Future: Send cancellation confirmation email
    });

    eventBus.on('funding:plan:suspended', (data: { fundingPlan: any }) => {
      logger.info({ id: data.fundingPlan.id }, 'Funding plan suspended');
      // Future: Send suspension notification email
    });

    eventBus.on('funding:plan:reactivated', (data: { fundingPlan: any }) => {
      logger.info({ id: data.fundingPlan.id }, 'Funding plan reactivated');
      // Future: Send reactivation confirmation email
    });

    eventBus.on('funding:plan:payment_failed', (data: { fundingPlan: any }) => {
      logger.info({ id: data.fundingPlan.id }, 'Funding plan payment failed');
      // Future: Send payment failure notification email
    });
  }
}
