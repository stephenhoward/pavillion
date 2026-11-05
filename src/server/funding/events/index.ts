import { EventEmitter } from 'events';
import { DomainEventHandlers } from '@/server/common/types/domain';
import { createLogger } from '@/server/common/helper/logger';
import { guardEventHandler } from '@/server/common/helper/guard-event-handler';
import { FundingPlan } from '@/common/model/funding-plan';
import type AccountsInterface from '@/server/accounts/interface';
import type EmailInterface from '@/server/email/interface';
import { FundingPlanNoticeEmail } from '@/server/funding/model/funding_plan_notice_email';
import PaymentFailedEmail from '@/server/funding/model/payment_failed_email';
import PlanSuspendedEmail from '@/server/funding/model/plan_suspended_email';
import PlanCancelledEmail from '@/server/funding/model/plan_cancelled_email';

const logger = createLogger('funding');

type FundingPlanPayload = { fundingPlan: FundingPlan };
type FundingPlanCancelledPayload = FundingPlanPayload & { immediate: boolean };

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
 *
 * payment_failed, suspended and cancelled send a dunning email to the plan's
 * owner — the account on the plan, never the calendars' other editors.
 * created and reactivated are log-only.
 */
export default class FundingEventHandlers implements DomainEventHandlers {
  private readonly emailInterface?: EmailInterface;
  private accountsInterface?: AccountsInterface;

  /**
   * @param emailInterface - Sends the dunning emails; without it they are skipped
   */
  constructor(emailInterface?: EmailInterface) {
    this.emailInterface = emailInterface;
  }

  /**
   * Injects AccountsInterface, used to resolve a plan owner's address and
   * language. Set after construction because the funding domain is initialized
   * before the accounts interface is handed to it.
   *
   * @param accountsInterface - The AccountsInterface instance from the accounts domain
   */
  setAccountsInterface(accountsInterface: AccountsInterface): void {
    this.accountsInterface = accountsInterface;
  }

  install(eventBus: EventEmitter): void {
    // Said once here so a miswired server is visible at startup; the per-event
    // warning in notifyPlanOwner still records each notice that went unsent.
    if (!this.emailInterface) {
      logger.warn('Funding plan dunning emails disabled: no email interface provided');
    }

    // The bus never awaits a listener, so each email handler goes through the
    // failure-catching wrapper: a rejected send is logged, not left unhandled.
    const guard = <T>(handler: (payload: T) => Promise<void>) =>
      guardEventHandler(handler, '[FUNDING] Domain-event handler failed');

    eventBus.on('funding:plan:created', (data: FundingPlanPayload) => {
      logger.info({ id: data.fundingPlan.id }, 'Funding plan created');
    });

    eventBus.on('funding:plan:reactivated', (data: FundingPlanPayload) => {
      logger.info({ id: data.fundingPlan.id }, 'Funding plan reactivated');
    });

    eventBus.on('funding:plan:payment_failed', guard(async (data: FundingPlanPayload) => {
      await this.notifyPlanOwner(data.fundingPlan, 'payment_failed',
        (email) => new PaymentFailedEmail(email, data.fundingPlan.billingCycle));
    }));

    eventBus.on('funding:plan:suspended', guard(async (data: FundingPlanPayload) => {
      await this.notifyPlanOwner(data.fundingPlan, 'suspended',
        (email) => new PlanSuspendedEmail(email, data.fundingPlan.billingCycle));
    }));

    eventBus.on('funding:plan:cancelled', guard(async (data: FundingPlanCancelledPayload) => {
      await this.notifyPlanOwner(data.fundingPlan, 'cancelled',
        (email) => new PlanCancelledEmail(email, data.fundingPlan.billingCycle, !data.immediate));
    }));
  }

  /**
   * Sends a dunning email to the account that owns the plan, in that
   * account's language.
   *
   * Logs which notice was sent for which plan — never the address or the
   * rendered link.
   *
   * @param plan - The plan whose lifecycle changed
   * @param notice - Which notice this is, for the log line
   * @param build - Builds the email for the owner's address
   */
  private async notifyPlanOwner(
    plan: FundingPlan,
    notice: string,
    build: (recipientEmail: string) => FundingPlanNoticeEmail,
  ): Promise<void> {
    if (!this.emailInterface || !this.accountsInterface) {
      logger.warn({ id: plan.id, notice }, 'Funding plan notice not sent: email or accounts interface unavailable');
      return;
    }

    const owner = await this.accountsInterface.getAccountById(plan.accountId);
    if (!owner?.email) {
      logger.warn({ id: plan.id, notice }, 'Funding plan notice not sent: plan owner not found');
      return;
    }

    const message = build(owner.email).buildMessage(owner.language || 'en');
    await this.emailInterface.sendEmail(message);

    logger.info({ id: plan.id, notice }, 'Funding plan notice sent to plan owner');
  }
}
