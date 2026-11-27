import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { UniqueConstraintError } from 'sequelize';

import { Calendar } from '@/common/model/calendar';
import { CalendarEvent } from '@/common/model/events';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import CalendarInterface from '@/server/calendar/interface';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { findOrCreateLocalEventObject } from '@/server/activitypub/helper/local-event-object';

describe('findOrCreateLocalEventObject', () => {
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;
  let getEventById: sinon.SinonStub;
  let getCalendar: sinon.SinonStub;
  let findOne: sinon.SinonStub;
  let create: sinon.SinonStub;

  // config/test.yaml sets domain to pavillion.dev
  const domain = 'pavillion.dev';
  const eventId = 'feedabc0-0000-0000-0000-000000000001';
  const owningCalendar = Calendar.fromObject({ id: 'owning-calendar-id', urlName: 'owningcal' });
  const canonicalApId = `https://${domain}/calendars/owningcal/events/${eventId}`;
  const actorUrl = `https://${domain}/calendars/owningcal`;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    calendarInterface = new CalendarInterface(new EventEmitter());
    getEventById = sandbox.stub(calendarInterface, 'getEventById')
      .resolves(new CalendarEvent(eventId, owningCalendar.id));
    getCalendar = sandbox.stub(calendarInterface, 'getCalendar').resolves(owningCalendar);
    findOne = sandbox.stub(EventObjectEntity, 'findOne').resolves(null);
    create = sandbox.stub(EventObjectEntity, 'create').callsFake(async (values: any) =>
      EventObjectEntity.build({ id: 'created-row-id', ...values }) as any,
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns the existing row for the event, looked up by event id', async () => {
    const existing = EventObjectEntity.build({
      id: 'existing-row-id',
      event_id: eventId,
      ap_id: canonicalApId,
      attributed_to: actorUrl,
    });
    findOne.resolves(existing);

    const result = await findOrCreateLocalEventObject(canonicalApId, calendarInterface);

    expect(result).toBe(existing);
    expect(findOne.firstCall.args[0]).toEqual({ where: { event_id: eventId } });
    expect(create.called).toBe(false);
  });

  it('creates a missing row with the canonical ap_id and the owning calendar as attribution', async () => {
    // The calendar segment is matched for shape only; the row is built from the owning calendar.
    const result = await findOrCreateLocalEventObject(
      `https://${domain}/calendars/someothername/events/${eventId}`,
      calendarInterface,
    );

    expect(create.calledOnce).toBe(true);
    expect(create.firstCall.args[0]).toEqual({
      event_id: eventId,
      ap_id: canonicalApId,
      attributed_to: actorUrl,
    });
    expect(result?.ap_id).toBe(canonicalApId);
    expect(getEventById.calledOnceWith(eventId)).toBe(true);
    expect(getCalendar.calledOnceWith(owningCalendar.id)).toBe(true);
  });

  it('resolves a URL whose host is upper case', async () => {
    const result = await findOrCreateLocalEventObject(
      `https://PAVILLION.DEV/calendars/owningcal/events/${eventId}`,
      calendarInterface,
    );

    expect(result?.ap_id).toBe(canonicalApId);
  });

  it('re-reads the winning row when a concurrent create hits the unique constraint', async () => {
    const winner = EventObjectEntity.build({
      id: 'winner-row-id',
      event_id: eventId,
      ap_id: canonicalApId,
      attributed_to: actorUrl,
    });
    findOne.onFirstCall().resolves(null);
    findOne.onSecondCall().resolves(winner);
    create.rejects(new UniqueConstraintError({}));

    const result = await findOrCreateLocalEventObject(canonicalApId, calendarInterface);

    expect(result).toBe(winner);
    expect(findOne.secondCall.args[0]).toEqual({ where: { event_id: eventId } });
  });

  it('rethrows a create error that is not a unique-constraint violation', async () => {
    create.rejects(new Error('database unavailable'));

    await expect(findOrCreateLocalEventObject(canonicalApId, calendarInterface))
      .rejects.toThrow('database unavailable');
  });

  describe('returns null and creates nothing', () => {
    const rejected: Array<[string, string]> = [
      ['a foreign host carrying a valid local UUID', `https://evil.example/calendars/owningcal/events/${eventId}`],
      ['a userinfo look-alike naming the local domain', `https://${domain}@evil.example/calendars/owningcal/events/${eventId}`],
      ['an empty-userinfo look-alike', `https://@evil.example/calendars/owningcal/events/${eventId}`],
      ['a URL carrying userinfo on the local host', `https://user:pass@${domain}/calendars/owningcal/events/${eventId}`],
      ['a different port', `https://${domain}:8443/calendars/owningcal/events/${eventId}`],
      ['http instead of https', `http://${domain}/calendars/owningcal/events/${eventId}`],
      ['a query string', `${canonicalApId}?x=1`],
      ['a fragment', `${canonicalApId}#frag`],
      ['an extra path segment', `${canonicalApId}/extra`],
      ['a trailing slash', `${canonicalApId}/`],
      ['a path that is not the event shape', `https://${domain}/events/${eventId}`],
      ['a malformed UUID', `https://${domain}/calendars/owningcal/events/feedabc0-0000-0000-0000-00000000000z`],
      ['an unparseable URL', 'not a url'],
    ];

    it.each(rejected)('for %s', async (_label, url) => {
      const result = await findOrCreateLocalEventObject(url, calendarInterface);

      expect(result).toBeNull();
      expect(getEventById.called).toBe(false);
      expect(create.called).toBe(false);
    });

    it('for an unknown UUID', async () => {
      getEventById.rejects(new EventNotFoundError());

      const result = await findOrCreateLocalEventObject(canonicalApId, calendarInterface);

      expect(result).toBeNull();
      expect(create.called).toBe(false);
    });

    it('for an event with no owning calendar', async () => {
      getEventById.resolves(new CalendarEvent(eventId, null));

      const result = await findOrCreateLocalEventObject(canonicalApId, calendarInterface);

      expect(result).toBeNull();
      expect(create.called).toBe(false);
    });

    it('when the owning calendar cannot be found', async () => {
      getCalendar.resolves(null);

      const result = await findOrCreateLocalEventObject(canonicalApId, calendarInterface);

      expect(result).toBeNull();
      expect(create.called).toBe(false);
    });
  });
});
