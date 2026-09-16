/**
 * DEC-018 rule 4 on the live federation surfaces: reserving a route segment
 * governs *claiming* a name, never *resolving* one.
 *
 * The startup collision report tells an operator that a calendar whose url name
 * collides with a reserved segment is unreachable at the site root "today", but
 * that it "still federates and serves its actor document" — which is the clause
 * that makes the rename a deliberate choice rather than an emergency. That
 * promise is only asserted as a substring of the log message elsewhere
 * (src/server/test/reserved-url-name-collisions-startup.test.ts); these tests
 * assert the fact underneath it.
 *
 * Every surface here funnels through `CalendarService.getCalendarByName`, which
 * gates on `CALENDAR_URL_NAME_RE` alone. If anyone adds an `isReservedRouteSegment`
 * check to that resolver — or to the actor, WebFinger or inbox routes above it —
 * an existing calendar named `admin` goes dark to the whole network: followers
 * stop resolving it, its handle stops answering, and inbound deliveries start
 * 404ing, with no remedy for its owner. These tests fail first.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';
import crypto from 'crypto';

import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import AccountService from '@/server/accounts/service/account';
import CalendarActorService from '@/server/activitypub/service/calendar_actor';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { isReservedRouteSegment } from '@/common/routing/reserved-segments';

// The canonical example the rest of this work uses. Asserting it is genuinely
// reserved keeps the whole file honest: if `admin` were ever dropped from the
// list these tests would silently stop testing anything.
const RESERVED_URL_NAME = 'admin';

describe('A calendar whose url name is a reserved route segment (DEC-018 rule 4)', () => {
  let env: TestEnvironment;
  let legacyCalendar: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const ownerInfo = await accountService._setupAccount('owner-reserved@pavillion.dev', 'testpassword');

    // Seeded the way history produces one of these: the calendar is created
    // through the ordinary validated path under a name that was claimable, then
    // the stored name is rewritten to what a later release reserved. Going
    // through createCalendar first is what gives the fixture an owner and a
    // real signing actor, so the actor-document assertions below are about a
    // fully-formed calendar rather than a bare row.
    legacyCalendar = await calendarInterface.createCalendar(ownerInfo.account, 'legacyname');
    await CalendarEntity.update(
      { url_name: RESERVED_URL_NAME },
      { where: { id: legacyCalendar.id } },
    );
    legacyCalendar.urlName = RESERVED_URL_NAME;

    // The signing actor is minted explicitly because the interfaces above are
    // wired to a test-local event bus, not the running app's, so the
    // calendar-created listener that would normally do it never fires here.
    await new CalendarActorService(calendarInterface).createActor(legacyCalendar, 'pavillion.dev');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('is a name the validator would refuse today, which is the whole point of the fixture', () => {
    expect(isReservedRouteSegment(RESERVED_URL_NAME)).toBe(true);
  });

  it('still serves its actor document, so remote followers do not lose the calendar', async () => {
    const response = await request(env.app)
      .get(`/calendars/${RESERVED_URL_NAME}`)
      .set('Accept', 'application/activity+json');

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(`https://pavillion.dev/calendars/${RESERVED_URL_NAME}`);
    expect(response.body.preferredUsername).toBe(RESERVED_URL_NAME);
    expect(response.body.inbox).toBe(`https://pavillion.dev/calendars/${RESERVED_URL_NAME}/inbox`);
  });

  it('still advertises the signing key peers verify its activities against', async () => {
    // The key is reached through the same resolver, one level deeper
    // (CalendarActorService.getActorByUrlName -> getCalendarByName). An actor
    // document that resolved but carried an empty publicKeyPem would leave the
    // calendar unable to prove authorship of anything it sends.
    const response = await request(env.app).get(`/calendars/${RESERVED_URL_NAME}`);

    expect(response.status).toBe(200);
    expect(response.body.publicKey.id).toBe(`https://pavillion.dev/calendars/${RESERVED_URL_NAME}#main-key`);
    expect(response.body.publicKey.publicKeyPem).toContain('BEGIN PUBLIC KEY');
  });

  it('still answers WebFinger, so the handle an operator published stays discoverable', async () => {
    const response = await request(env.app)
      .get('/.well-known/webfinger')
      .query({ resource: `acct:${RESERVED_URL_NAME}@pavillion.dev` });

    expect(response.status).toBe(200);
    expect(response.body.subject).toBe(`acct:${RESERVED_URL_NAME}@pavillion.dev`);
    expect(response.body.links.some(
      (link: { rel: string; href: string }) =>
        link.rel === 'self' && link.href === `https://pavillion.dev/calendars/${RESERVED_URL_NAME}`,
    )).toBe(true);
  });

  describe('inbound inbox delivery', () => {
    let originalSkipSignatures: string | undefined;

    beforeEach(() => {
      // Same bypass inbox-auth.integration.test.ts uses: the calendar lookup
      // this test is about runs in the route handler, below the signature
      // middleware, so real keys would add setup without adding coverage.
      originalSkipSignatures = process.env.SKIP_SIGNATURES;
      process.env.SKIP_SIGNATURES = 'true';
    });

    afterEach(() => {
      if (originalSkipSignatures === undefined) {
        delete process.env.SKIP_SIGNATURES;
      }
      else {
        process.env.SKIP_SIGNATURES = originalSkipSignatures;
      }
    });

    it('still accepts deliveries into its inbox, so remote activity does not silently stop arriving', async () => {
      const activityId = 'https://remote.example.com/activities/reserved-name-delivery';
      const announceActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Announce',
        actor: 'https://remote.example.com/calendars/somepeer',
        object: 'https://remote.example.com/events/reserved-name-delivery',
      };

      const response = await request(env.app)
        .post(`/calendars/${RESERVED_URL_NAME}/inbox`)
        .set('Content-Type', 'application/activity+json')
        .set('Date', new Date().toUTCString())
        .set('Host', 'localhost')
        .set('Signature',
          'keyId="https://remote.example.com/calendars/somepeer#main-key",algorithm="rsa-sha256",'
          + 'headers="(request-target) host date content-type digest",signature="fakeSignature"')
        .set('Digest', `SHA-256=${crypto.createHash('sha256').update(JSON.stringify(announceActivity)).digest('base64')}`)
        .send(announceActivity);

      expect(response.status).toBe(200);
      expect(await ActivityPubInboxMessageEntity.findByPk(activityId)).not.toBeNull();
    });
  });
});
