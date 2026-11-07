import { BillingCycle } from '@/common/model/funding-plan';
import { compileTemplate } from '@/server/common/email/message';
import { FundingPlanNoticeEmail } from '@/server/funding/model/funding_plan_notice_email';

const textTemplate = compileTemplate('src/server/funding', 'funding_plan_suspended_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/funding', 'funding_plan_suspended_email.html.hbs');

/**
 * Email telling a funding plan's owner that the plan was suspended after its
 * grace period ran out unpaid, with a link to reactivate it.
 */
export default class PlanSuspendedEmail extends FundingPlanNoticeEmail {
  constructor(recipientEmail: string, billingCycle: BillingCycle) {
    super('funding_plan_suspended_email', textTemplate, htmlTemplate, recipientEmail, billingCycle);
  }
}
