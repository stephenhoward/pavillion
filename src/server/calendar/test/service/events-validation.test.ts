import { describe, it, expect, beforeEach } from 'vitest';
import EventsService from '@/server/calendar/service/events';
import { ValidationError } from '@/common/exceptions/base';
import { Account } from '@/common/model/account';
import { EventEmitter } from 'events';

describe('EventsService - Validation', () => {
  let service: EventsService;
  let mockAccount: Account;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    service = new EventsService(eventBus);
    mockAccount = new Account('test-account-id');
    mockAccount.email = 'test@example.com';
  });

  describe('getEventById', () => {
    it('should throw ValidationError when eventId is empty', async () => {
      await expect(
        service.getEventById(''),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.getEventById(''),
      ).rejects.toThrow('eventId is required');
    });

    it('should throw ValidationError when eventId is whitespace', async () => {
      await expect(
        service.getEventById('   '),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.getEventById('   '),
      ).rejects.toThrow('eventId is required');
    });
  });

  describe('updateEvent', () => {
    it('should throw ValidationError when eventId is empty', async () => {
      await expect(
        service.updateEvent(mockAccount, '', {}),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.updateEvent(mockAccount, '', {}),
      ).rejects.toThrow('Event ID is required');
    });
  });

  describe('deleteEvent', () => {
    it('should throw ValidationError when eventId is empty', async () => {
      await expect(
        service.deleteEvent(mockAccount, ''),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.deleteEvent(mockAccount, ''),
      ).rejects.toThrow('Event ID is required');
    });
  });

  describe('bulkAssignCategories', () => {
    it('should throw ValidationError when eventIds is not an array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, null as any, ['cat-1']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, null as any, ['cat-1']),
      ).rejects.toThrow('eventIds must be a non-empty array');
    });

    it('should throw ValidationError when eventIds is empty array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, [], ['cat-1']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, [], ['cat-1']),
      ).rejects.toThrow('eventIds must be a non-empty array');
    });

    it('should throw ValidationError when categoryIds is not an array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], null as any),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], null as any),
      ).rejects.toThrow('categoryIds must be a non-empty array');
    });

    it('should throw ValidationError when categoryIds is empty array', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], []),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], []),
      ).rejects.toThrow('categoryIds must be a non-empty array');
    });

    it('should throw ValidationError when eventIds contains non-string', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, [123 as any, 'event-2'], ['cat-1']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, [123 as any, 'event-2'], ['cat-1']),
      ).rejects.toThrow('all eventIds must be strings');
    });

    it('should throw ValidationError when categoryIds contains non-string', async () => {
      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], [123 as any, 'cat-2']),
      ).rejects.toThrow(ValidationError);

      await expect(
        service.bulkAssignCategories(mockAccount, ['event-1'], [123 as any, 'cat-2']),
      ).rejects.toThrow('all categoryIds must be strings');
    });
  });
});
