import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import ActivityPubService from '@/server/activitypub/service/server';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import config from 'config';

describe('ActivityPubService.parseWebFingerResource', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ActivityPubService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should parse user handle with @ prefix correctly', () => {
    const result = service.parseWebFingerResource('acct:@alice@example.com');

    expect(result).toEqual({
      type: 'user',
      name: 'alice',
      domain: 'example.com',
    });
  });

  it('should parse calendar handle without @ prefix correctly', () => {
    const result = service.parseWebFingerResource('acct:community@example.com');

    expect(result).toEqual({
      type: 'calendar',
      name: 'community',
      domain: 'example.com',
    });
  });

  it('should handle resource without acct: prefix', () => {
    const result = service.parseWebFingerResource('@alice@example.com');

    expect(result).toEqual({
      type: 'user',
      name: 'alice',
      domain: 'example.com',
    });
  });

  it('should return empty result for malformed handle with no domain', () => {
    const result = service.parseWebFingerResource('acct:alice');

    expect(result).toEqual({
      type: 'unknown',
      name: '',
      domain: '',
    });
  });

  it('should return empty result for empty resource', () => {
    const result = service.parseWebFingerResource('');

    expect(result).toEqual({
      type: 'unknown',
      name: '',
      domain: '',
    });
  });

  it('should handle calendar handle with only local name', () => {
    const result = service.parseWebFingerResource('community@example.com');

    expect(result).toEqual({
      type: 'calendar',
      name: 'community',
      domain: 'example.com',
    });
  });
});

describe('ActivityPubService.lookupWebFinger', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ActivityPubService;
  let eventBus: EventEmitter;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ActivityPubService(eventBus);
    calendarInterface = new CalendarInterface(eventBus);
    accountsInterface = new AccountsInterface(eventBus);

    // Stub config domain
    sandbox.stub(config, 'get').withArgs('domain').returns('events.example');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return Person actor link for user lookup', async () => {
    // Mock user lookup
    const mockAccount = {
      id: 'account-123',
      username: 'alice',
      email: 'alice@example.com',
    };

    sandbox.stub(accountsInterface, 'getAccountByUsername').resolves(mockAccount);
    sandbox.stub(service, 'accountsService').value(accountsInterface);

    const result = await service.lookupWebFinger('alice', 'events.example', 'user');

    expect(result).not.toBeNull();
    expect(result?.subject).toBe('acct:@alice@events.example');
    expect(result?.links[0].href).toBe('https://events.example/users/alice');
  });

  it('should return Group actor link for calendar lookup', async () => {
    // Mock calendar lookup
    const mockCalendar = {
      id: 'cal-123',
      urlName: 'community',
    };

    sandbox.stub(calendarInterface, 'getCalendarByName').resolves(mockCalendar);
    sandbox.stub(service, 'calendarService').value(calendarInterface);

    const result = await service.lookupWebFinger('community', 'events.example', 'calendar');

    expect(result).not.toBeNull();
    expect(result?.subject).toBe('acct:community@events.example');
    expect(result?.links[0].href).toBe('https://events.example/calendars/community');
  });

  it('should return null for non-existent user', async () => {
    sandbox.stub(accountsInterface, 'getAccountByUsername').resolves(null);
    sandbox.stub(service, 'accountsService').value(accountsInterface);

    const result = await service.lookupWebFinger('nonexistent', 'events.example', 'user');

    expect(result).toBeNull();
  });

  it('should return null for wrong domain', async () => {
    const mockCalendar = {
      id: 'cal-123',
      urlName: 'community',
    };

    sandbox.stub(calendarInterface, 'getCalendarByName').resolves(mockCalendar);
    sandbox.stub(service, 'calendarService').value(calendarInterface);

    const result = await service.lookupWebFinger('community', 'wrong.example', 'calendar');

    expect(result).toBeNull();
  });
});
