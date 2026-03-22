import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { createLogger } from '@/server/common/helper/logger';

const logger = createLogger('funding');

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
      logger.info({ id: data.subscription.id }, 'Funding plan created');
      // Future: Send confirmation email, update analytics, etc.
    });

    eventBus.on('funding_plan:cancelled', (data: { funding_plan: any; immediate: boolean }) => {
      logger.info({ id: data.subscription.id, immediate: data.immediate }, 'Funding plan cancelled');
      // Future: Send cancellation confirmation email
    });

    eventBus.on('funding_plan:suspended', (data: { funding_plan: any }) => {
      logger.info({ id: data.subscription.id }, 'Funding plan suspended');
      // Future: Send suspension notification email
    });

    eventBus.on('funding_plan:reactivated', (data: { funding_plan: any }) => {
      logger.info({ id: data.subscription.id }, 'Funding plan reactivated');
      // Future: Send reactivation confirmation email
    });

    eventBus.on('funding_plan:payment_failed', (data: { funding_plan: any }) => {
      logger.info({ id: data.subscription.id }, 'Funding plan payment failed');
      // Future: Send payment failure notification email
    });
  }
}
