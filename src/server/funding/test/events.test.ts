import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import i18next from 'i18next';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { FundingPlan } from '@/common/model/funding-plan';
import FundingEventHandlers from '@/server/funding/events';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
import { MailData } from '@/server/common/email/types';
import { initI18Next } from '@/server/common/test/lib/i18next';
import { dispatchAndAwait } from '@/server/common/test/helpers/emit-and-settle';

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock('@/server/common/helper/error-logger', () => ({
  logError: mockLogError,
}));

initI18Next();

beforeAll(async () => {
  await i18next.loadLanguages(['en', 'es']);
  await i18next.loadNamespaces('funding_plan_suspended_email');
});

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/**
 * A plan carrying every provider-side value the dunning emails must never
 * show: the amount, the Stripe customer and subscription ids, and the period
 * dates.
 */
function planOwnedBy(accountId: string): FundingPlan {
  return FundingPlan.fromObject({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    accountId,
    providerSubscriptionId: 'sub_SECRET123',
    providerCustomerId: 'cus_SECRET456',
    status: 'past_due',
    billingCycle: 'monthly',
    amount: 1234500,
    currency: 'USD',
    currentPeriodEnd: '2026-12-01T00:00:00Z',
  });
}

describe('FundingEventHandlers dunning emails', () => {
  let eventBus: EventEmitter;
  let sentEmails: MailData[];
  let accountsInterface: AccountsInterface;
  let getAccountById: ReturnType<typeof vi.fn>;
  let handlers: FundingEventHandlers;

  beforeEach(() => {
    mockLogError.mockClear();
    eventBus = new EventEmitter();
    sentEmails = [];

    const owner = new Account(OWNER_ID, 'owner', 'owner@example.com');
    owner.language = 'en';
    getAccountById = vi.fn(async (id: string) => (id === OWNER_ID ? owner : undefined));
    accountsInterface = { getAccountById } as unknown as AccountsInterface;

    const emailInterface = {
      sendEmail: async (data: MailData) => {
        sentEmails.push(data);
        return null;
      },
    } as unknown as EmailInterface;

    handlers = new FundingEventHandlers(emailInterface);
    handlers.setAccountsInterface(accountsInterface);
    handlers.install(eventBus);
  });

  it('emails the plan owner when a payment fails', async () => {
    await dispatchAndAwait(eventBus, 'funding:plan:payment_failed', { fundingPlan: planOwnedBy(OWNER_ID) });

    expect(getAccountById).toHaveBeenCalledWith(OWNER_ID);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].emailAddress).toBe('owner@example.com');
    expect(sentEmails[0].subject).toBe('A payment for your funding plan didn\'t go through');
  });

  it('emails the plan owner when a plan is suspended', async () => {
    await dispatchAndAwait(eventBus, 'funding:plan:suspended', { fundingPlan: planOwnedBy(OWNER_ID) });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].emailAddress).toBe('owner@example.com');
    expect(sentEmails[0].subject).toBe('Your funding plan has been suspended');
  });

  it('emails the plan owner when a plan is cancelled, distinguishing period-end from immediate', async () => {
    await dispatchAndAwait(eventBus, 'funding:plan:cancelled', { fundingPlan: planOwnedBy(OWNER_ID), immediate: false });
    await dispatchAndAwait(eventBus, 'funding:plan:cancelled', { fundingPlan: planOwnedBy(OWNER_ID), immediate: true });

    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[0].subject).toBe('Your funding plan has been cancelled');
    expect(sentEmails[0].textMessage).toContain('until the end of the current billing period');
    expect(sentEmails[1].textMessage).toContain('Calendars it covered no longer have access');
  });

  it('sends in the plan owner\'s preferred language', async () => {
    const owner = new Account(OWNER_ID, 'owner', 'owner@example.com');
    owner.language = 'es';
    getAccountById.mockResolvedValue(owner);

    await dispatchAndAwait(eventBus, 'funding:plan:suspended', { fundingPlan: planOwnedBy(OWNER_ID) });

    expect(sentEmails[0].subject).toBe('Tu plan de financiación ha sido suspendido');
  });

  it('never puts provider payment details into the email', async () => {
    for (const event of ['funding:plan:payment_failed', 'funding:plan:suspended', 'funding:plan:cancelled']) {
      await dispatchAndAwait(eventBus, event, { fundingPlan: planOwnedBy(OWNER_ID), immediate: true });
    }

    expect(sentEmails).toHaveLength(3);
    for (const email of sentEmails) {
      const content = `${email.subject}\n${email.textMessage}\n${email.htmlMessage}`;
      expect(content).not.toContain('SECRET');
      expect(content).not.toContain('12.35');
      expect(content).not.toContain('1234500');
      expect(content).not.toContain(OWNER_ID);
    }
  });

  it('sends nothing when the plan owner cannot be resolved', async () => {
    await dispatchAndAwait(eventBus, 'funding:plan:payment_failed', {
      fundingPlan: planOwnedBy('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
    });

    expect(sentEmails).toHaveLength(0);
  });

  it('logs and absorbs a failed send instead of rejecting on the bus', async () => {
    const failing = new FundingEventHandlers({
      sendEmail: async () => { throw new Error('SMTP down'); },
    } as unknown as EmailInterface);
    failing.setAccountsInterface(accountsInterface);
    const bus = new EventEmitter();
    failing.install(bus);

    await expect(
      dispatchAndAwait(bus, 'funding:plan:suspended', { fundingPlan: planOwnedBy(OWNER_ID) }),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it('sends no email for created or reactivated plans', async () => {
    await dispatchAndAwait(eventBus, 'funding:plan:created', { fundingPlan: planOwnedBy(OWNER_ID) });
    await dispatchAndAwait(eventBus, 'funding:plan:reactivated', { fundingPlan: planOwnedBy(OWNER_ID) });

    expect(sentEmails).toHaveLength(0);
  });
});
