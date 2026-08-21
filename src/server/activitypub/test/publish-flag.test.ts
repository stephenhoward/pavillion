/**
 * Unit tests for `ActivityPubInterface.publishFlag`.
 *
 * This is the seam a moderation report crosses to become ActivityPub. The
 * moderation domain passes its own `Report` and the reported event and gets
 * back only the IRI the Flag went out under; the activity itself is built,
 * signed and anchored here. These tests pin that contract from the interface
 * side — that the signing calendar's actor reaches the wire, that the outbox
 * receives a model rather than a literal (it persists `toObject()`), and that
 * the returned IRI is the one the report row will record.
 *
 * The moderation-side tests stub `publishFlag` wholesale, so without this file
 * the translation is only exercised by the Docker-gated federation suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubMemberService from '@/server/activitypub/service/members';
import FlagActivity from '@/server/activitypub/model/action/flag';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';

const LOCAL_ACTOR_URI = 'https://local.instance/calendars/test-calendar';
const REMOTE_TARGET_ACTOR_URI = 'https://remote.instance/calendars/origin-calendar';
const REMOTE_EVENT_IRI = 'https://remote.instance/calendars/origin-calendar/events/event-uuid';

function buildReport(): Report {
  const report = new Report('report-uuid');
  report.eventId = 'local-copy-uuid';
  report.calendarId = 'calendar-id';
  report.category = ReportCategory.SPAM;
  report.description = 'Report description text';
  report.reporterType = 'authenticated';
  report.status = ReportStatus.SUBMITTED;
  report.createdAt = new Date('2026-02-10T12:00:00Z');
  return report;
}

function buildReportedEvent(): CalendarEvent {
  return CalendarEvent.fromObject({
    id: 'local-copy-uuid',
    calendarId: null,
    eventSourceUrl: REMOTE_EVENT_IRI,
  });
}

describe('ActivityPubInterface.publishFlag', () => {
  let sandbox: sinon.SinonSandbox;
  let apInterface: ActivityPubInterface;
  let addToOutboxStub: sinon.SinonStub;
  let actorUrlStub: sinon.SinonStub;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    addToOutboxStub = sandbox.stub(ActivityPubMemberService.prototype, 'addToOutbox').resolves();
    actorUrlStub = sandbox.stub(ActivityPubMemberService.prototype, 'actorUrl').resolves(LOCAL_ACTOR_URI);

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    apInterface = new ActivityPubInterface(
      eventBus,
      calendarInterface,
      new AccountsInterface(eventBus),
    );

    calendar = Calendar.fromObject({ id: 'calendar-id', urlName: 'test-calendar' });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('hands the outbox a FlagActivity anchored on the signing calendar', async () => {
    await apInterface.publishFlag(calendar, buildReport(), buildReportedEvent(), REMOTE_TARGET_ACTOR_URI);

    expect(addToOutboxStub.calledOnce).toBe(true);
    const [calendarArg, activityArg] = addToOutboxStub.firstCall.args;

    // The signing calendar must pass through untouched — the outbox anchors
    // the Flag on it and signs with its key.
    expect(calendarArg).toBe(calendar);
    // A model instance, not a literal. The outbox persists
    // `message.toObject()`, which a plain object literal does not provide.
    expect(activityArg).toBeInstanceOf(FlagActivity);
  });

  it('derives the Flag actor from the signing calendar', async () => {
    // The HTTP-Signature keyId resolves to the signing calendar's key, so an
    // actor derived from anything else is refused at the far end.
    await apInterface.publishFlag(calendar, buildReport(), buildReportedEvent(), REMOTE_TARGET_ACTOR_URI);

    expect(actorUrlStub.calledWith(calendar)).toBe(true);
    expect(addToOutboxStub.firstCall.args[1].actor).toBe(LOCAL_ACTOR_URI);
  });

  it('persists a complete Flag built from the report', async () => {
    await apInterface.publishFlag(calendar, buildReport(), buildReportedEvent(), REMOTE_TARGET_ACTOR_URI);

    // Assert on what the outbox actually persists, not on the model fields.
    const persisted = addToOutboxStub.firstCall.args[1].toObject();

    expect(persisted).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      actor: LOCAL_ACTOR_URI,
      to: [REMOTE_TARGET_ACTOR_URI],
      object: REMOTE_EVENT_IRI,
      content: 'Report description text',
      summary: 'Event report: spam',
      published: '2026-02-10T12:00:00.000Z',
    });
    expect(persisted.tag).toEqual([{ type: 'Hashtag', name: '#spam' }]);
  });

  it('mints the Flag IRI from the `domain` config key', async () => {
    // `domain` is the key this application defines; `server.domain` is not,
    // and reading it threw before a Flag was ever built. Sinon returns
    // undefined for unmatched args, so a regression to the wrong key would
    // flow `domain: undefined` into the minted IRI and be caught here.
    const configStub = sandbox.stub(config, 'get');
    configStub.withArgs('domain').returns('local.instance');

    const flagId = await apInterface.publishFlag(
      calendar,
      buildReport(),
      buildReportedEvent(),
      REMOTE_TARGET_ACTOR_URI,
    );

    expect(flagId).toMatch(/^https:\/\/local\.instance\/flags\//);
  });

  it('returns the IRI of the Flag it published', async () => {
    // The report row records this as `forwarded_report_id`; an acknowledgement
    // from the recipient is matched back against it.
    const flagId = await apInterface.publishFlag(
      calendar,
      buildReport(),
      buildReportedEvent(),
      REMOTE_TARGET_ACTOR_URI,
    );

    expect(flagId).toBe(addToOutboxStub.firstCall.args[1].id);
    expect(flagId).toBeTruthy();
  });
});
