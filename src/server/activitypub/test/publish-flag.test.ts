/**
 * Unit tests for `ActivityPubInterface.publishFlag`.
 *
 * This method exists because the moderation domain builds a Flag in its wire
 * form (a plain object literal) but the outbox persists `message.toObject()`.
 * Handing the literal straight to `addToOutbox` therefore wrote a Flag with no
 * body. `publishFlag` is the seam where the AP domain parses the wire form into
 * its own activity model before the outbox ever sees it.
 *
 * The moderation-side tests stub `publishFlag` wholesale, so without this file
 * the parse — and the malformed-input rejection that goes with it — is only
 * exercised by the Docker-gated federation suite.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import ActivityPubInterface from '@/server/activitypub/interface';
import ActivityPubMemberService from '@/server/activitypub/service/members';
import FlagActivity from '@/server/activitypub/model/action/flag';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';

const LOCAL_ACTOR_URI = 'https://local.instance/calendars/test-calendar';
const REMOTE_TARGET_ACTOR_URI = 'https://remote.instance/calendars/origin-calendar';
const REMOTE_EVENT_IRI = 'https://remote.instance/calendars/origin-calendar/events/event-uuid';
const FLAG_ID = 'https://local.instance/flags/8d2b6a1e-0a3c-4f5b-9c1d-2e3f4a5b6c7d';

/** The wire form moderation's FlagActivityBuilder produces. */
function buildFlagWireObject(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Flag',
    id: FLAG_ID,
    actor: LOCAL_ACTOR_URI,
    to: [REMOTE_TARGET_ACTOR_URI],
    object: REMOTE_EVENT_IRI,
    content: 'Report description text',
    tag: [{ type: 'Hashtag', name: '#spam' }],
    summary: 'Event report: spam',
    published: '2026-02-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('ActivityPubInterface.publishFlag', () => {
  let sandbox: sinon.SinonSandbox;
  let apInterface: ActivityPubInterface;
  let addToOutboxStub: sinon.SinonStub;
  let calendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    addToOutboxStub = sandbox.stub(ActivityPubMemberService.prototype, 'addToOutbox').resolves();

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

  it('parses the wire form into a FlagActivity before handing it to the outbox', async () => {
    await apInterface.publishFlag(calendar, buildFlagWireObject());

    expect(addToOutboxStub.calledOnce).toBe(true);
    const [calendarArg, activityArg] = addToOutboxStub.firstCall.args;

    // The signing calendar must pass through untouched — the outbox anchors
    // the Flag on it and signs with its key.
    expect(calendarArg).toBe(calendar);
    // A model instance, not the literal. This is the whole point of the
    // method: the outbox persists `message.toObject()`, which a plain object
    // literal does not provide.
    expect(activityArg).toBeInstanceOf(FlagActivity);
  });

  it('preserves the wire fields through the parse so the persisted Flag is complete', async () => {
    await apInterface.publishFlag(calendar, buildFlagWireObject());

    // Assert on what the outbox actually persists, not on the model fields.
    const persisted = addToOutboxStub.firstCall.args[1].toObject();

    expect(persisted).toMatchObject({
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Flag',
      id: FLAG_ID,
      actor: LOCAL_ACTOR_URI,
      to: [REMOTE_TARGET_ACTOR_URI],
      object: REMOTE_EVENT_IRI,
      content: 'Report description text',
      summary: 'Event report: spam',
      published: '2026-02-10T12:00:00.000Z',
    });
    expect(persisted.tag).toEqual([{ type: 'Hashtag', name: '#spam' }]);
  });

  it('throws and does not reach the outbox when the object is not a Flag', async () => {
    const notAFlag = buildFlagWireObject({ type: 'Create' });

    await expect(apInterface.publishFlag(calendar, notAFlag))
      .rejects.toThrow('Cannot publish Flag: malformed Flag activity');
    expect(addToOutboxStub.called).toBe(false);
  });

  it('throws and does not reach the outbox when required Flag fields are missing', async () => {
    // `object` is the reported event IRI. A Flag without it names nothing, so
    // the parse rejects rather than emitting an unactionable report.
    const noObject = buildFlagWireObject();
    delete noObject.object;

    await expect(apInterface.publishFlag(calendar, noObject))
      .rejects.toThrow('Cannot publish Flag: malformed Flag activity');
    expect(addToOutboxStub.called).toBe(false);
  });
});
