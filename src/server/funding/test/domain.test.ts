import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { FundingPlan } from '@/common/model/funding-plan';
import FundingDomain from '@/server/funding';
import type AccountsInterface from '@/server/accounts/interface';
import type EmailInterface from '@/server/email/interface';
import { MailData } from '@/server/common/email/types';
import { initI18Next } from '@/server/common/test/lib/i18next';
import { dispatchAndAwait } from '@/server/common/test/helpers/emit-and-settle';

const { warnStub } = vi.hoisted(() => ({ warnStub: vi.fn() }));

vi.mock('@/server/common/helper/logger', () => {
  const stubLogger = { warn: warnStub, info: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { createLogger: () => stubLogger, default: stubLogger };
});

// The hourly grace-period and grant jobs are not under test and would leave
// timers running.
vi.mock('@/server/funding/service/jobs', () => ({
  startScheduledJobs: () => () => {},
}));

initI18Next();

const OWNER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const suspendedPlan = (): FundingPlan => FundingPlan.fromObject({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  accountId: OWNER_ID,
  status: 'suspended',
  billingCycle: 'monthly',
});

/**
 * The domain wiring the dunning emails depend on, in server.ts's order:
 * construct with the email interface, initialize (which installs the event
 * handlers), and only then receive the accounts interface.
 */
describe('FundingDomain dunning email wiring', () => {
  let eventBus: EventEmitter;
  let sentEmails: MailData[];
  let emailInterface: EmailInterface;
  let accountsInterface: AccountsInterface;

  beforeEach(() => {
    warnStub.mockClear();
    eventBus = new EventEmitter();
    sentEmails = [];
    emailInterface = {
      sendEmail: async (data: MailData) => {
        sentEmails.push(data);
        return null;
      },
    } as unknown as EmailInterface;
    accountsInterface = {
      getAccountById: async (id: string) =>
        (id === OWNER_ID ? new Account(OWNER_ID, 'owner', 'owner@example.com') : undefined),
    } as unknown as AccountsInterface;
  });

  it('emails the plan owner once a suspension is emitted', async () => {
    const domain = new FundingDomain(eventBus, emailInterface);
    domain.initialize(express());
    domain.setAccountsInterface(accountsInterface);

    await dispatchAndAwait(eventBus, 'funding:plan:suspended', { fundingPlan: suspendedPlan() });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].emailAddress).toBe('owner@example.com');
    expect(warnStub).not.toHaveBeenCalled();
    domain.shutdown();
  });

  it('sends nothing, and does not reject, before the accounts interface arrives', async () => {
    const domain = new FundingDomain(eventBus, emailInterface);
    domain.initialize(express());

    await expect(
      dispatchAndAwait(eventBus, 'funding:plan:suspended', { fundingPlan: suspendedPlan() }),
    ).resolves.toBeUndefined();
    expect(sentEmails).toHaveLength(0);
    domain.shutdown();
  });

  it('warns once at startup, and does not reject, without an email interface', async () => {
    const domain = new FundingDomain(eventBus);
    domain.initialize(express());
    domain.setAccountsInterface(accountsInterface);

    expect(warnStub).toHaveBeenCalledTimes(1);
    expect(warnStub.mock.calls[0][0]).toContain('no email interface');

    await expect(
      dispatchAndAwait(eventBus, 'funding:plan:suspended', { fundingPlan: suspendedPlan() }),
    ).resolves.toBeUndefined();
    domain.shutdown();
  });
});
