import { BillingCycle } from '@/common/model/funding-plan';
import { compileTemplate } from '@/server/common/email/message';
import { FundingPlanNoticeEmail } from '@/server/funding/model/funding_plan_notice_email';

const textTemplate = compileTemplate('src/server/funding', 'funding_plan_cancelled_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/funding', 'funding_plan_cancelled_email.html.hbs');

/**
 * Email confirming a funding plan's cancellation to its owner.
 *
 * A period-end cancellation keeps coverage until the paid-through date, an
 * immediate one ends it now; the body says which. The date itself is not
 * rendered — the settings page the action link opens shows it.
 */
export default class PlanCancelledEmail extends FundingPlanNoticeEmail {
  atPeriodEnd: boolean;

  constructor(recipientEmail: string, billingCycle: BillingCycle, atPeriodEnd: boolean) {
    super('funding_plan_cancelled_email', textTemplate, htmlTemplate, recipientEmail, billingCycle);
    this.atPeriodEnd = atPeriodEnd;
  }

  protected statusData(): Record<string, boolean> {
    return { atPeriodEnd: this.atPeriodEnd };
  }
}
