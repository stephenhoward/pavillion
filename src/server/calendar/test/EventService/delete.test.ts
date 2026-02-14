import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import EventService from '../../service/events';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventContentEntity, EventScheduleEntity } from '../../entity/event';
import { EventInstanceEntity } from '../../entity/event_instance';
import { LocationEntity } from '../../entity/location';
import { MediaEntity } from '../../../media/entity/media';
import { EventCategoryAssignmentEntity } from '../../entity/event_category_assignment';
import { CalendarMemberEntity } from '../../entity/calendar_member';
import { CalendarActorEntity } from '../../../activitypub/entity/calendar_actor';
import { EventNotFoundError, InsufficientCalendarPermissionsError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import db from '@/server/common/entity/db';

describe('EventService.deleteEvent', () => {
  let sandbox: sinon.SinonSandbox;
  let eventService: EventService;
  let mockTransaction: any;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventService = new EventService(new EventEmitter());

    // Mock transaction
    mockTransaction = {
      commit: sandbox.stub(),
      rollback: sandbox.stub(),
    };
    sandbox.stub(db, 'transaction').resolves(mockTransaction);

    // Stub destroy methods on the prototype to prevent database writes
    sandbox.stub(EventInstanceEntity, 'destroy').resolves();
    sandbox.stub(EventContentEntity, 'destroy').resolves();
    sandbox.stub(EventScheduleEntity, 'destroy').resolves();
    sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves();
    sandbox.stub(EventEntity.prototype, 'destroy').resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should successfully delete an event with all related data', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const calendar = new Calendar('calendar-123', 'test-calendar');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    // Mock the event entity
    const mockEventEntity = {
      calendar_id: 'calendar-123',
      destroy: sandbox.stub().resolves(),
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);
    sandbox.stub(eventService['calendarService'], 'getCalendar').resolves(calendar);
    sandbox.stub(eventService['calendarService'], 'userCanModifyCalendar').resolves(true);
    const eventBusEmitSpy = sandbox.spy(eventService['eventBus'], 'emit');

    await eventService.deleteEvent(account, eventId);

    // Verify all related data is deleted using sinon assertions
    expect((EventInstanceEntity.destroy as sinon.SinonStub).calledWith({
      where: { event_id: eventId },
      transaction: mockTransaction,
    })).toBe(true);

    expect((EventCategoryAssignmentEntity.destroy as sinon.SinonStub).calledWith({
      where: { event_id: eventId },
      transaction: mockTransaction,
    })).toBe(true);

    expect((EventScheduleEntity.destroy as sinon.SinonStub).calledWith({
      where: { event_id: eventId },
      transaction: mockTransaction,
    })).toBe(true);

    expect((EventContentEntity.destroy as sinon.SinonStub).calledWith({
      where: { event_id: eventId },
      transaction: mockTransaction,
    })).toBe(true);

    expect(mockEventEntity.destroy.calledWith({ transaction: mockTransaction })).toBe(true);
    expect(mockTransaction.commit.calledOnce).toBe(true);

    // Verify event bus emission for ActivityPub federation
    expect(eventBusEmitSpy.calledWith('event_deleted', {
      eventId,
      calendar,
      account,
    })).toBe(true);
  });

  it('should throw EventNotFoundError when event does not exist', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const eventId = '00000000-0000-4000-8000-000000000000'; // Valid UUID but doesn't exist

    sandbox.stub(EventEntity, 'findByPk').resolves(null);

    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(EventNotFoundError);
    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(`Event with ID ${eventId} not found`);
  });

  it('should throw EventNotFoundError when event not found and calendarId provided but no remote membership', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const eventId = '22222222-2222-4222-8222-222222222222'; // Valid UUID for remote event
    const calendarId = 'remote-calendar-actor-123';

    // Mock event not found locally
    sandbox.stub(EventEntity, 'findByPk').resolves(null);

    // Mock no remote membership found
    sandbox.stub(CalendarMemberEntity, 'findOne').resolves(null);

    await expect(eventService.deleteEvent(account, eventId, calendarId))
      .rejects.toThrow(EventNotFoundError);
    await expect(eventService.deleteEvent(account, eventId, calendarId))
      .rejects.toThrow(`Event with ID ${eventId} not found`);
  });

  it('should throw CalendarNotFoundError when calendar does not exist', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    const mockEventEntity = {
      calendar_id: 'nonexistent-calendar',
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);
    sandbox.stub(eventService['calendarService'], 'getCalendar').resolves(null);

    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(CalendarNotFoundError);
    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(`Calendar not found for event ${eventId}`);
  });

  it('should throw InsufficientCalendarPermissionsError when user cannot modify calendar', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const calendar = new Calendar('calendar-123', 'test-calendar');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    const mockEventEntity = {
      calendar_id: 'calendar-123',
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);
    sandbox.stub(eventService['calendarService'], 'getCalendar').resolves(calendar);
    sandbox.stub(eventService['calendarService'], 'userCanModifyCalendar').resolves(false);

    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(InsufficientCalendarPermissionsError);
    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(`User does not have permission to delete events in calendar ${calendar.urlName}`);
  });

  it('should throw InsufficientCalendarPermissionsError when trying to delete remote event', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const eventId = '22222222-2222-4222-8222-222222222222'; // Valid UUID for remote event

    // Mock a remote event (calendar_id is null for remote events stored locally)
    const mockEventEntity = {
      calendar_id: null,
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(InsufficientCalendarPermissionsError);
    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow('Cannot delete remote events through this method - use deleteRemoteEvent');
  });

  it('should rollback transaction on database error', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const calendar = new Calendar('calendar-123', 'test-calendar');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    const mockEventEntity = {
      calendar_id: 'calendar-123',
      destroy: sandbox.stub().rejects(new Error('Database error')),
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);
    sandbox.stub(eventService['calendarService'], 'getCalendar').resolves(calendar);
    sandbox.stub(eventService['calendarService'], 'userCanModifyCalendar').resolves(true);

    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow('Database error');

    expect(mockTransaction.rollback.calledOnce).toBe(true);
    expect(mockTransaction.commit.called).toBe(false);
  });

  it('should include all related entities when finding the event', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    const findByPkStub = sandbox.stub(EventEntity, 'findByPk').resolves(null);

    await expect(eventService.deleteEvent(account, eventId))
      .rejects.toThrow(EventNotFoundError);

    expect(findByPkStub.calledWith(eventId, {
      include: [EventContentEntity, LocationEntity, EventScheduleEntity, MediaEntity],
    })).toBe(true);
  });

  it('should handle deletion of event with no related data', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const calendar = new Calendar('calendar-123', 'test-calendar');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    const mockEventEntity = {
      calendar_id: 'calendar-123',
      destroy: sandbox.stub().resolves(),
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);
    sandbox.stub(eventService['calendarService'], 'getCalendar').resolves(calendar);
    sandbox.stub(eventService['calendarService'], 'userCanModifyCalendar').resolves(true);

    // Make related entity deletions resolve to 0 (no records deleted)
    (EventContentEntity.destroy as sinon.SinonStub).resolves(0);
    (EventScheduleEntity.destroy as sinon.SinonStub).resolves(0);
    (EventCategoryAssignmentEntity.destroy as sinon.SinonStub).resolves(0);

    await eventService.deleteEvent(account, eventId);

    // Should still proceed with main event deletion
    expect(mockEventEntity.destroy.calledWith({ transaction: mockTransaction })).toBe(true);
    expect(mockTransaction.commit.calledOnce).toBe(true);
  });

  it('should verify calendar service calls with correct parameters', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const calendar = new Calendar('calendar-123', 'test-calendar');
    const eventId = '11111111-1111-4111-8111-111111111111'; // Valid UUID

    const mockEventEntity = {
      calendar_id: 'calendar-123',
      destroy: sandbox.stub().resolves(),
    };

    sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);
    const getCalendarStub = sandbox.stub(eventService['calendarService'], 'getCalendar').resolves(calendar);
    const userCanModifyStub = sandbox.stub(eventService['calendarService'], 'userCanModifyCalendar').resolves(true);

    await eventService.deleteEvent(account, eventId);

    expect(getCalendarStub.calledWith('calendar-123')).toBe(true);
    expect(userCanModifyStub.calledWith(account, calendar)).toBe(true);
  });

  it('should call deleteRemoteEventViaActivityPub when event not found locally but valid remote membership exists', async () => {
    const account = new Account('account-123', 'test@example.com', 'test@example.com');
    const eventId = '22222222-2222-4222-8222-222222222222'; // Valid UUID for remote event
    const calendarId = 'remote-calendar-actor-456';

    // Mock event not found locally
    sandbox.stub(EventEntity, 'findByPk').resolves(null);

    // Mock calendar actor with toModel method
    const mockCalendarActor = {
      id: 'remote-calendar-actor-456',
      actor_uri: 'https://remote.example.com/calendars/test-calendar',
      inbox_url: 'https://remote.example.com/inbox',
      toModel: sandbox.stub().returns({
        id: 'remote-calendar-actor-456',
        actorType: 'remote' as const,
        calendarId: null,
        actorUri: 'https://remote.example.com/calendars/test-calendar',
        remoteDisplayName: 'Test Remote Calendar',
        remoteDomain: 'remote.example.com',
        inboxUrl: 'https://remote.example.com/inbox',
        sharedInboxUrl: null,
        lastFetched: new Date(),
        publicKey: 'mock-public-key',
        privateKey: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    // Mock remote membership found
    const mockRemoteMembership = {
      account_id: 'account-123',
      calendar_actor_id: 'remote-calendar-actor-456',
      calendar_id: null,
      role: 'editor',
      calendarActor: mockCalendarActor,
    };

    sandbox.stub(CalendarMemberEntity, 'findOne').resolves(mockRemoteMembership as any);

    // Stub the private deleteRemoteEventViaActivityPub method
    const deleteRemoteStub = sandbox.stub(eventService as any, 'deleteRemoteEventViaActivityPub').resolves();

    // Call deleteEvent with calendarId
    await eventService.deleteEvent(account, eventId, calendarId);

    // Verify findOne was called with correct parameters
    expect((CalendarMemberEntity.findOne as sinon.SinonStub).calledWith({
      where: {
        account_id: account.id,
        calendar_actor_id: calendarId,
        calendar_id: null,
      },
      include: [{ model: CalendarActorEntity, as: 'calendarActor' }],
    })).toBe(true);

    // Verify deleteRemoteEventViaActivityPub was called with correct parameters
    expect(deleteRemoteStub.calledOnce).toBe(true);
    expect(deleteRemoteStub.firstCall.args[0]).toEqual(account);
    expect(deleteRemoteStub.firstCall.args[1]).toEqual(mockCalendarActor.toModel());
    expect(deleteRemoteStub.firstCall.args[2]).toEqual(eventId);
  });
});
