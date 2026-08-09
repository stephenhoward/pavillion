import { describe, it, expect } from 'vitest';

import type { NotificationResponse, NotificationTarget } from '@/common/model/notification';

/**
 * `NotificationTarget` only ever reaches the client as JSON, so the contract
 * under test is that each variant survives serialization with its discriminant
 * and payload keys intact.
 */
describe('NotificationTarget wire shape', () => {

  const makeResponse = (target: NotificationTarget | null): NotificationResponse => ({
    id: 'notif-1',
    activityId: 'activity-1',
    verb: 'Follow',
    origin: 'federated',
    actor: {
      kind: 'remote_actor',
      displayName: 'Alice',
      displayUrl: 'https://example.com/alice',
    },
    object: {
      type: 'calendar',
      id: 'cal-1',
      label: 'My Calendar',
      target,
    },
    seen: false,
    dismissed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  const roundTrip = (target: NotificationTarget | null): NotificationTarget | null =>
    (JSON.parse(JSON.stringify(makeResponse(target))) as NotificationResponse).object.target;

  it('round-trips an event target', () => {
    expect(roundTrip({ kind: 'event', eventId: 'evt-1' })).toEqual({
      kind: 'event',
      eventId: 'evt-1',
    });
  });

  it('round-trips a calendar target', () => {
    expect(roundTrip({ kind: 'calendar', calendarUrlName: 'my-calendar' })).toEqual({
      kind: 'calendar',
      calendarUrlName: 'my-calendar',
    });
  });

  it('round-trips a moderation_report target', () => {
    expect(roundTrip({ kind: 'moderation_report', reportId: 'rep-1' })).toEqual({
      kind: 'moderation_report',
      reportId: 'rep-1',
    });
  });

  it('round-trips an owner_report target with both payload keys', () => {
    expect(roundTrip({
      kind: 'owner_report',
      reportId: 'rep-1',
      calendarUrlName: 'my-calendar',
    })).toEqual({
      kind: 'owner_report',
      reportId: 'rep-1',
      calendarUrlName: 'my-calendar',
    });
  });

  it('keeps a null target null', () => {
    expect(roundTrip(null)).toBeNull();
  });

  it('preserves the surrounding object projection alongside the target', () => {
    const parsed = JSON.parse(JSON.stringify(
      makeResponse({ kind: 'event', eventId: 'evt-1' }),
    )) as NotificationResponse;

    expect(parsed.object).toEqual({
      type: 'calendar',
      id: 'cal-1',
      label: 'My Calendar',
      target: { kind: 'event', eventId: 'evt-1' },
    });
  });
});
