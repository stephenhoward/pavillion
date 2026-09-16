import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import config from 'config';

import { Calendar } from '@/common/model/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import CalendarService from '@/server/calendar/service/calendar';

const TEST_DOMAIN: string = config.get('domain');

/**
 * `Calendar.publicUrl` is not an internal convenience: the public API hands it
 * to anonymous callers and the client SPA shows it to an organizer as their
 * calendar's shareable address. It is one of the only surfaces that tells a
 * HUMAN where their calendar lives, so it has to be the address DEC-018
 * actually serves — the domain root, not the retired `/view/` spelling that SSR
 * and the site router both stopped answering.
 *
 * Every read path funnels through the same private stamp, so covering one
 * resolver covers the shape.
 */
describe('CalendarService public URL', () => {
  let sandbox: sinon.SinonSandbox;
  let service: CalendarService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new CalendarService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('stamps the calendar with its absolute root-shaped public address', async () => {
    const entity = { toModel: () => new Calendar('calendar-id', 'test-calendar') };
    sandbox.stub(CalendarEntity, 'findOne').resolves(entity as any);

    const calendar = await service.getCalendarByName('test-calendar');

    expect(calendar!.publicUrl).toBe(`https://${TEST_DOMAIN}/test-calendar`);
  });

  it('stamps the same address on a lookup by id', async () => {
    const entity = { toModel: () => new Calendar('calendar-id', 'test-calendar') };
    sandbox.stub(CalendarEntity, 'findByPk').resolves(entity as any);

    const calendar = await service.getCalendar('b0a5d1d4-2f26-4f3a-8f0a-9c8e5d2a1f77');

    expect(calendar!.publicUrl).toBe(`https://${TEST_DOMAIN}/test-calendar`);
  });
});
