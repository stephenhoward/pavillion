import { EventEmitter } from 'events';
import { describe, expect, it, afterEach } from 'vitest';
import sinon from 'sinon';

import ActivityPubDomain from '@/server/activitypub';
import ActivityPubEventHandlers from '@/server/activitypub/events';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';

function buildDomain(eventBus: EventEmitter): ActivityPubDomain {
  return new ActivityPubDomain(
    eventBus,
    new CalendarInterface(eventBus),
    new AccountsInterface(),
    { publishJob: async () => {} } as unknown as HousekeepingInterface,
  );
}

describe('ActivityPubDomain.pendingDispatchCount', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  it('is 0 before the event handlers are installed', () => {
    const domain = buildDomain(new EventEmitter());

    expect(domain.pendingDispatchCount).toBe(0);
  });

  it('reports the installed event handlers\' queued lifecycle count', () => {
    sandbox.stub(ActivityPubEventHandlers.prototype, 'pendingDispatchCount').get(() => 7);
    const domain = buildDomain(new EventEmitter());
    domain.installEventHandlers();

    expect(domain.pendingDispatchCount).toBe(7);
  });
});
