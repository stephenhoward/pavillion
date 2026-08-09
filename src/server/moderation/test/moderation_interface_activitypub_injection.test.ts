/**
 * Late-binding guard for the Moderation → ActivityPub interface injection.
 *
 * The ActivityPub domain is constructed AFTER moderation (the AP inbox needs
 * ModerationInterface for instance blocking and inbound Flag handling), so
 * moderation cannot receive the AP interface as a constructor argument. Every
 * outbound federation path in moderation — forwarding a report as a Flag,
 * resolving the origin calendar actor to address it to — is dead code until
 * `setActivityPubInterface` runs.
 *
 * That setter is exactly what broke in production: `ModerationDomain` delegated
 * to a `ModerationInterface.setActivityPubInterface` that did not exist, so the
 * interface stayed undefined and every forward threw a TypeError. It survived
 * because every other unit test hands the AP interface to the
 * `ModerationService` constructor and never touches the setter.
 *
 * These tests drive the setter and pin both fields it is responsible for: the
 * one on `ModerationInterface` (read by `getEventSourceActorUri`) and the one
 * it forwards to `ModerationService` (read by `forwardReport`). The
 * `ModerationDomain` → `ModerationInterface` hop above them is covered by
 * `src/server/common/test/rate-limit-coverage.test.ts`, which reconstructs the
 * real wiring graph; importing the domain entry point here would drag
 * isomorphic-dompurify in and force this suite out of the fast pool.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ModerationInterface from '@/server/moderation/interface';
import { ReportNotFoundError } from '@/server/moderation/exceptions';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import EmailInterface from '@/server/email/interface';
// Type-only: importing the runtime module reaches ServiceSettings →
// renderPolicyMarkdown → isomorphic-dompurify, which the default vmThreads
// pool cannot evaluate. Nothing on these paths calls it, so a bare cast keeps
// this suite in the fast pool (see the project notes in vitest.config.ts).
import type ConfigurationInterface from '@/server/configuration/interface';
import ActivityPubInterface from '@/server/activitypub/interface';

const REPORT_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const EVENT_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
const REMOTE_TARGET_ACTOR_URI = 'https://remote.instance/calendars/origin-calendar';
const ORIGIN_ACTOR_URI = 'https://remote.instance/calendars/origin-calendar';

describe('Moderation ActivityPub late binding', () => {
  let sandbox: sinon.SinonSandbox;
  let moderationInterface: ModerationInterface;
  let mockActivityPubInterface: ActivityPubInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const eventBus = new EventEmitter();
    // Constructed exactly as server.ts constructs it: no ActivityPub interface.
    moderationInterface = new ModerationInterface(
      eventBus,
      new CalendarInterface(eventBus),
      new AccountsInterface(eventBus),
      new EmailInterface(),
      {} as ConfigurationInterface,
    );
    mockActivityPubInterface = {
      getEventSourceActorUri: sandbox.stub().resolves(ORIGIN_ACTOR_URI),
    } as unknown as ActivityPubInterface;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('before setActivityPubInterface runs', () => {
    it('fails forwardReport with the documented guard rather than a TypeError', async () => {
      await expect(
        moderationInterface.forwardReport(REPORT_ID, REMOTE_TARGET_ACTOR_URI),
      ).rejects.toThrow('ActivityPubInterface is required for forwardReport');
    });

    it('fails getEventSourceActorUri with the documented guard rather than a TypeError', async () => {
      await expect(
        moderationInterface.getEventSourceActorUri(EVENT_ID),
      ).rejects.toThrow('ActivityPubInterface is required for getEventSourceActorUri');
    });
  });

  describe('after setActivityPubInterface runs', () => {
    it('reaches the service so forwardReport clears its ActivityPub guard', async () => {
      moderationInterface.setActivityPubInterface(mockActivityPubInterface);

      // Report lookup is the first step past the AP guard, so reaching a
      // ReportNotFoundError proves the service now holds the interface — the
      // setter's forward into ModerationService is what the production defect
      // never performed.
      sandbox.stub(moderationInterface.getModerationService(), 'getReportById').resolves(null);

      await expect(
        moderationInterface.forwardReport(REPORT_ID, REMOTE_TARGET_ACTOR_URI),
      ).rejects.toThrow(ReportNotFoundError);
    });

    it('reaches the interface so getEventSourceActorUri delegates to ActivityPub', async () => {
      moderationInterface.setActivityPubInterface(mockActivityPubInterface);

      const result = await moderationInterface.getEventSourceActorUri(EVENT_ID);

      expect(result).toBe(ORIGIN_ACTOR_URI);
      expect((mockActivityPubInterface.getEventSourceActorUri as sinon.SinonStub)
        .calledOnceWith(EVENT_ID)).toBe(true);
    });
  });
});
