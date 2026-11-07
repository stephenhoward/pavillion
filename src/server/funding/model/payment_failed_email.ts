import { BillingCycle } from '@/common/model/funding-plan';
import { compileTemplate } from '@/server/common/email/message';
import { FundingPlanNoticeEmail } from '@/server/funding/model/funding_plan_notice_email';

const textTemplate = compileTemplate('src/server/funding', 'funding_plan_payment_failed_email.text.hbs');
const htmlTemplate = compileTemplate('src/server/funding', 'funding_plan_payment_failed_email.html.hbs');

/**
 * Email telling a funding plan's owner that a renewal payment failed and the
 * plan is now past due, with a link to update their payment details.
 */
export default class PaymentFailedEmail extends FundingPlanNoticeEmail {
  constructor(recipientEmail: string, billingCycle: BillingCycle) {
    super('funding_plan_payment_failed_email', textTemplate, htmlTemplate, recipientEmail, billingCycle);
  }
}
