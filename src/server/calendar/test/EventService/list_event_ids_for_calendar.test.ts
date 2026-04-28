import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Calendar } from '@/common/model/calendar';
import { EventEntity } from '@/server/calendar/entity/event';
import { EventRepostEntity } from '@/server/calendar/entity/event_repost';
import EventService from '@/server/calendar/service/events';

/**
 * Coverage for EventService.listEventIdsForCalendar (pv-hr72.1).
 *
 * The helper returns the deduped union of event ids visible on a calendar
 * across three sources: own events (EventEntity.calendar_id), repost links
 * (EventRepostEntity.event_id), and AP shares (ap_shared_event keys via
 * ActivityPubInterface.getSharedEventStatusMap).
 *
 * This file absorbs the dedup coverage that previously lived in
 * EventInstanceService/repost-instances.test.ts (deleted in pv-hr72.3).
 */
describe('EventService.listEventIdsForCalendar', () => {
  const CALENDAR_ID = 'cal-id-1';
  const calendar = new Calendar(CALENDAR_ID, 'testcal');

  // Pre-baked UUIDs so the helper's UUID filter accepts them.
  const OWNED_ID = '11111111-1111-4111-8111-111111111111';
  const REPOST_ID = '22222222-2222-4222-8222-222222222222';
  const SHARED_AUTO_ID = '33333333-3333-4333-8333-333333333333';
  const SHARED_MANUAL_ID = '44444444-4444-4444-8444-444444444444';
  const OVERLAP_ID = '55555555-5555-4555-8555-555555555555';

  let service: EventService;
  let sandbox: sinon.SinonSandbox;

  function buildMockApInterface(statusMap: Map<string, 'auto' | 'manual'> = new Map()) {
    return {
      getSharedEventStatusMap: sinon.stub().resolves(statusMap),
    } as any;
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EventService(new EventEmitter());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns own event ids when there are no reposts or shares', async () => {
    sandbox.stub(EventEntity, 'findAll').resolves([
      EventEntity.build({ id: OWNED_ID, calendar_id: CALENDAR_ID }),
    ]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
    service.setActivityPubInterface(buildMockApInterface());

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids.sort()).toEqual([OWNED_ID]);
  });

  it('returns repost-linked event ids when there are no own events or shares', async () => {
    sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      { event_id: REPOST_ID } as any,
    ]);
    service.setActivityPubInterface(buildMockApInterface());

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids.sort()).toEqual([REPOST_ID]);
  });

  it('returns shared event ids when there are no own events or reposts', async () => {
    sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
    const statusMap = new Map<string, 'auto' | 'manual'>([
      [SHARED_AUTO_ID, 'auto'],
      [SHARED_MANUAL_ID, 'manual'],
    ]);
    service.setActivityPubInterface(buildMockApInterface(statusMap));

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids.sort()).toEqual([SHARED_AUTO_ID, SHARED_MANUAL_ID].sort());
  });

  it('returns the deduped union when the same id appears across multiple sources', async () => {
    // OVERLAP_ID is "owned" AND has a repost row AND appears in the
    // shared-event map. Output must contain it exactly once.
    sandbox.stub(EventEntity, 'findAll').resolves([
      EventEntity.build({ id: OVERLAP_ID, calendar_id: CALENDAR_ID }),
    ]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      { event_id: OVERLAP_ID } as any,
    ]);
    const statusMap = new Map<string, 'auto' | 'manual'>([
      [OVERLAP_ID, 'auto'],
    ]);
    service.setActivityPubInterface(buildMockApInterface(statusMap));

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids).toEqual([OVERLAP_ID]);
  });

  it('returns the deduped union across all three distinct sources', async () => {
    sandbox.stub(EventEntity, 'findAll').resolves([
      EventEntity.build({ id: OWNED_ID, calendar_id: CALENDAR_ID }),
    ]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([
      { event_id: REPOST_ID } as any,
    ]);
    const statusMap = new Map<string, 'auto' | 'manual'>([
      [SHARED_AUTO_ID, 'auto'],
      [SHARED_MANUAL_ID, 'manual'],
    ]);
    service.setActivityPubInterface(buildMockApInterface(statusMap));

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids.sort()).toEqual(
      [OWNED_ID, REPOST_ID, SHARED_AUTO_ID, SHARED_MANUAL_ID].sort(),
    );
  });

  it('filters out non-UUID identifiers from the shared-event map', async () => {
    // Legacy ap_shared_event rows may carry AP URLs rather than EventEntity
    // ids. The helper must skip those so callers can safely Op.in the result
    // against EventEntity.id.
    sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
    const statusMap = new Map<string, 'auto' | 'manual'>([
      ['https://remote.example/events/abc', 'auto'],
      ['not-a-uuid', 'manual'],
      [SHARED_AUTO_ID, 'auto'],
    ]);
    service.setActivityPubInterface(buildMockApInterface(statusMap));

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids).toEqual([SHARED_AUTO_ID]);
  });

  it('returns an empty array when there are no events visible on the calendar', async () => {
    sandbox.stub(EventEntity, 'findAll').resolves([]);
    sandbox.stub(EventRepostEntity, 'findAll').resolves([]);
    service.setActivityPubInterface(buildMockApInterface());

    const ids = await service.listEventIdsForCalendar(calendar);

    expect(ids).toEqual([]);
  });
});
