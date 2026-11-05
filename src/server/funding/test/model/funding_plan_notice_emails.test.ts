import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import PaymentFailedEmail from '@/server/funding/model/payment_failed_email';
import PlanSuspendedEmail from '@/server/funding/model/plan_suspended_email';
import PlanCancelledEmail from '@/server/funding/model/plan_cancelled_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

beforeAll(async () => {
  // Load every language the tests render in, so the synchronous t() lookups
  // resolve translated content instead of falling back to English.
  await i18next.loadLanguages(['en', 'es', 'fr']);
  await i18next.loadNamespaces([
    'funding_plan_payment_failed_email',
    'funding_plan_suspended_email',
    'funding_plan_cancelled_email',
  ]);
});

/*
 * Rendered against the real locale files and templates. config/test.yaml sets
 * the instance domain to pavillion.dev, which is where the action link and the
 * plan name point.
 */
const ACTION_URL = 'https://pavillion.dev/settings/account/funding';

describe('PaymentFailedEmail', () => {
  it('is addressed to the recipient it was built for', () => {
    const message = new PaymentFailedEmail('owner@example.com', 'monthly').buildMessage('en');

    expect(message.emailAddress).toBe('owner@example.com');
    expect(message.subject).toBe('A payment for your funding plan didn\'t go through');
  });

  it('names the plan by billing cycle and instance in both bodies', () => {
    const message = new PaymentFailedEmail('owner@example.com', 'yearly').buildMessage('en');

    expect(message.textMessage).toContain('yearly funding plan supporting pavillion.dev');
    expect(message.htmlMessage).toContain('yearly funding plan supporting pavillion.dev');
  });

  it('links to the funding plan settings leaf in both bodies', () => {
    const message = new PaymentFailedEmail('owner@example.com', 'monthly').buildMessage('en');

    expect(message.textMessage).toContain(ACTION_URL);
    expect(message.htmlMessage).toContain(`href="${ACTION_URL}"`);
  });

  it('renders in the requested language', () => {
    const message = new PaymentFailedEmail('owner@example.com', 'monthly').buildMessage('es');

    expect(message.subject).toBe('No se pudo procesar un pago de tu plan de financiación');
    expect(message.textMessage).toContain('plan de financiación mensual que apoya a pavillion.dev');
  });
});

describe('PlanSuspendedEmail', () => {
  it('tells the owner the plan is suspended and links to the settings leaf', () => {
    const message = new PlanSuspendedEmail('owner@example.com', 'monthly').buildMessage('en');

    expect(message.emailAddress).toBe('owner@example.com');
    expect(message.subject).toBe('Your funding plan has been suspended');
    expect(message.textMessage).toContain('Your monthly funding plan supporting pavillion.dev has been suspended');
    expect(message.textMessage).toContain(ACTION_URL);
    expect(message.htmlMessage).toContain(`href="${ACTION_URL}"`);
  });
});

describe('PlanCancelledEmail', () => {
  it('says coverage has ended for an immediate cancellation', () => {
    const message = new PlanCancelledEmail('owner@example.com', 'monthly', false).buildMessage('en');

    expect(message.subject).toBe('Your funding plan has been cancelled');
    expect(message.textMessage).toContain('Calendars it covered no longer have access');
    expect(message.textMessage).not.toContain('until the end of the current billing period');
    expect(message.htmlMessage).toContain('Calendars it covered no longer have access');
  });

  it('offers a new plan after an immediate cancellation', () => {
    const message = new PlanCancelledEmail('owner@example.com', 'monthly', false).buildMessage('en');

    expect(message.textMessage).toContain('You can start a new funding plan at any time.');
    expect(message.textMessage).not.toContain('Changed your mind?');
  });

  it('offers to keep the plan, not to start a new one, during a period-end cancellation', () => {
    // A new checkout is refused while the plan winds down; the linked page
    // offers to keep it instead.
    const message = new PlanCancelledEmail('owner@example.com', 'monthly', true).buildMessage('en');

    expect(message.textMessage).toContain('Changed your mind? You can keep your plan');
    expect(message.htmlMessage).toContain('Changed your mind? You can keep your plan');
    expect(message.textMessage).not.toContain('start a new funding plan');
    expect(message.htmlMessage).not.toContain('start a new funding plan');
  });

  it('translates the period-end offer', () => {
    expect(new PlanCancelledEmail('owner@example.com', 'monthly', true).buildMessage('es').textMessage)
      .toContain('¿Has cambiado de opinión?');
    expect(new PlanCancelledEmail('owner@example.com', 'monthly', true).buildMessage('fr').textMessage)
      .toContain('Vous avez changé d\'avis ?');
  });

  it('says coverage runs to the period end for a period-end cancellation', () => {
    const message = new PlanCancelledEmail('owner@example.com', 'yearly', true).buildMessage('en');

    expect(message.textMessage).toContain('until the end of the current billing period');
    expect(message.textMessage).not.toContain('Calendars it covered no longer have access');
    expect(message.htmlMessage).toContain('until the end of the current billing period');
  });

  it('links to the funding plan settings leaf', () => {
    const message = new PlanCancelledEmail('owner@example.com', 'monthly', false).buildMessage('fr');

    expect(message.textMessage).toContain(ACTION_URL);
    expect(message.htmlMessage).toContain(`href="${ACTION_URL}"`);
  });
});
