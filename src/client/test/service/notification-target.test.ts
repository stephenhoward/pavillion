import { describe, it, expect } from 'vitest';

import { routeFor } from '@/client/service/notification-target';
import type { NotificationTarget } from '@/common/model/notification';

describe('routeFor', () => {

  it('maps an event target to the event_edit route', () => {
    expect(routeFor({ kind: 'event', eventId: 'evt-1' })).toEqual({
      name: 'event_edit',
      params: { eventId: 'evt-1' },
    });
  });

  it('maps a calendar target to the calendar_widget leaf, the first one an invited editor can open', () => {
    expect(routeFor({ kind: 'calendar', calendarUrlName: 'my-calendar' })).toEqual({
      name: 'calendar_widget',
      params: { calendar: 'my-calendar' },
    });
  });

  it('maps a moderation_report target to the moderation_report_detail route', () => {
    expect(routeFor({ kind: 'moderation_report', reportId: 'rep-1' })).toEqual({
      name: 'moderation_report_detail',
      params: { reportId: 'rep-1' },
    });
  });

  it('maps an owner_report target to the calendar_report_detail leaf with no query', () => {
    expect(routeFor({
      kind: 'owner_report',
      reportId: 'rep-1',
      calendarUrlName: 'my-calendar',
    })).toEqual({
      name: 'calendar_report_detail',
      params: { calendar: 'my-calendar', reportId: 'rep-1' },
    });
  });

  it('returns null for a null target', () => {
    expect(routeFor(null)).toBeNull();
  });

  it('returns null for a kind it does not recognise instead of throwing', () => {
    const fromNewerServer = { kind: 'settings_tab', tab: 'notifications' } as unknown as NotificationTarget;

    expect(() => routeFor(fromNewerServer)).not.toThrow();
    expect(routeFor(fromNewerServer)).toBeNull();
  });
});
