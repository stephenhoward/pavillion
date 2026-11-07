import config from 'config';
import i18next from 'i18next';
import { TemplateDelegate } from 'handlebars';
import { BillingCycle } from '@/common/model/funding-plan';
import { MailData } from '@/server/common/email/types';
import { EmailMessage } from '@/server/common/email/message';
import { publicUrl } from '@/server/common/helper/public-url';
import { fundingPlanPath } from '@/server/common/helper/settings-links';

/**
 * Base for the dunning emails sent to a funding plan's owner when the plan's
 * lifecycle changes (payment failed, suspended, cancelled).
 *
 * The template data contract is deliberately narrow: a plan name, a
 * high-level status, and the action link. Subclasses are constructed from the
 * billing cycle alone — never from the FundingPlan — so the amount, currency,
 * provider customer and subscription ids, and any provider decline detail
 * cannot reach the Handlebars context, however a template is later edited.
 *
 * The action link is the funding plan settings leaf. It carries no token, so
 * it is safe to render; callers still log the notice sent, never the link.
 */
export abstract class FundingPlanNoticeEmail extends EmailMessage {
  recipientEmail: string;
  billingCycle: BillingCycle;

  constructor(
    namespace: string,
    textTemplate: TemplateDelegate<any>,
    htmlTemplate: TemplateDelegate<any>,
    recipientEmail: string,
    billingCycle: BillingCycle,
  ) {
    super(namespace, textTemplate, htmlTemplate);
    this.recipientEmail = recipientEmail;
    this.billingCycle = billingCycle;
  }

  /**
   * High-level status values a subclass adds to the template data. Booleans
   * only: anything richer belongs in the translation, not the context.
   */
  protected statusData(): Record<string, boolean> {
    return {};
  }

  buildMessage(language: string): MailData {
    const templateData = {
      language,
      planName: this.planName(language),
      actionUrl: publicUrl(fundingPlanPath()),
      ...this.statusData(),
    };

    return {
      emailAddress: this.recipientEmail,
      subject: this.renderSubject(language, {}),
      textMessage: this.renderPlaintext(language, { ...templateData }),
      htmlMessage: this.renderHtml(language, { ...templateData }),
    };
  }

  /**
   * The plan as the owner knows it: its billing cycle and the instance it
   * supports, e.g. "monthly funding plan supporting events.example.org".
   */
  private planName(language: string): string {
    return i18next.t('plan_name', {
      ns: this.namespace,
      lng: language,
      context: this.billingCycle,
      domain: config.get<string>('domain'),
    });
  }
}
