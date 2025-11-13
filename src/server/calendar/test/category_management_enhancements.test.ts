import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CategoryService from '../service/categories';
import CalendarService from '../service/calendar';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryEntity } from '../entity/event_category';
import { EventCategoryContentEntity } from '../entity/event_category_content';
import { EventCategoryAssignmentEntity } from '../entity/event_category_assignment';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { CategoryNotFoundError } from '@/common/exceptions/category';
import db from '@/server/common/entity/db';

describe('CategoryService - Management Enhancements', () => {
  let sandbox: sinon.SinonSandbox;
  let categoryService: CategoryService;
  let mockCalendarService: sinon.SinonStubbedInstance<CalendarService>;
  let testAccount: Account;
  let testCalendar: Calendar;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock CalendarService
    mockCalendarService = sandbox.createStubInstance(CalendarService);
    categoryService = new CategoryService(mockCalendarService as any);

    // Create test data
    testAccount = new Account('account-123', 'test@example.com', 'testuser');
    testCalendar = new Calendar('calendar-123', 'account-123');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('deleteCategory with migration options', () => {
    it('should delete category and migrate events to target category', async () => {
      const mockCategory = new EventCategory('category-source', 'calendar-123');
      const mockTargetCategory = new EventCategory('category-target', 'calendar-123');

      const getCategoryStub = sandbox.stub(categoryService, 'getCategory');
      getCategoryStub.withArgs('category-source', 'calendar-123').resolves(mockCategory);
      getCategoryStub.withArgs('category-target', 'calendar-123').resolves(mockTargetCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Stub transaction
      const mockTransaction = {
        commit: sandbox.stub(),
        rollback: sandbox.stub(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);

      // Stub update and delete operations
      const updateStub = sandbox.stub(EventCategoryAssignmentEntity, 'update').resolves([3] as any);

      // Stub raw query for duplicate removal
      sandbox.stub(db, 'query').resolves([]);

      sandbox.stub(EventCategoryContentEntity, 'destroy').resolves(1);
      sandbox.stub(EventCategoryEntity, 'destroy').resolves(1);

      const affectedCount = await categoryService.deleteCategory(
        testAccount,
        'category-source',
        'calendar-123',
        'migrate',
        'category-target'
      );

      expect(affectedCount).toBe(3);
      expect(updateStub.calledOnce).toBeTruthy();
      expect(mockTransaction.commit.calledOnce).toBeTruthy();
    });

    it('should delete category and remove all event assignments', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Stub transaction
      const mockTransaction = {
        commit: sandbox.stub(),
        rollback: sandbox.stub(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);

      // Stub delete operations
      const assignmentDestroyStub = sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(5);
      sandbox.stub(EventCategoryContentEntity, 'destroy').resolves(1);
      sandbox.stub(EventCategoryEntity, 'destroy').resolves(1);

      const affectedCount = await categoryService.deleteCategory(
        testAccount,
        'category-123',
        'calendar-123',
        'remove'
      );

      expect(affectedCount).toBe(5);
      expect(assignmentDestroyStub.calledOnce).toBeTruthy();
      expect(mockTransaction.commit.calledOnce).toBeTruthy();
    });

    it('should throw error if target category does not exist', async () => {
      const mockCategory = new EventCategory('category-source', 'calendar-123');
      const getCategoryStub = sandbox.stub(categoryService, 'getCategory');
      getCategoryStub.withArgs('category-source', 'calendar-123').resolves(mockCategory);
      getCategoryStub.withArgs('category-invalid', 'calendar-123').rejects(new CategoryNotFoundError());

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      await expect(
        categoryService.deleteCategory(
          testAccount,
          'category-source',
          'calendar-123',
          'migrate',
          'category-invalid'
        )
      ).rejects.toThrow(CategoryNotFoundError);
    });

    it('should rollback transaction on error', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Stub transaction
      const mockTransaction = {
        commit: sandbox.stub(),
        rollback: sandbox.stub(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);

      // Stub to throw error during delete
      sandbox.stub(EventCategoryAssignmentEntity, 'destroy').rejects(new Error('Database error'));

      await expect(
        categoryService.deleteCategory(testAccount, 'category-123', 'calendar-123', 'remove')
      ).rejects.toThrow('Database error');

      expect(mockTransaction.rollback.calledOnce).toBeTruthy();
    });
  });

  describe('mergeCategories', () => {
    it('should merge multiple categories into target category', async () => {
      const mockTargetCategory = new EventCategory('category-target', 'calendar-123');
      const mockSource1 = new EventCategory('category-source1', 'calendar-123');
      const mockSource2 = new EventCategory('category-source2', 'calendar-123');

      const getCategoryStub = sandbox.stub(categoryService, 'getCategory');
      getCategoryStub.withArgs('category-target', 'calendar-123').resolves(mockTargetCategory);
      getCategoryStub.withArgs('category-source1').resolves(mockSource1);
      getCategoryStub.withArgs('category-source2').resolves(mockSource2);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Stub transaction
      const mockTransaction = {
        commit: sandbox.stub(),
        rollback: sandbox.stub(),
      };
      sandbox.stub(db, 'transaction').resolves(mockTransaction as any);

      // Stub update and delete operations
      const updateStub = sandbox.stub(EventCategoryAssignmentEntity, 'update');
      updateStub.onFirstCall().resolves([3] as any); // 3 events from source1
      updateStub.onSecondCall().resolves([2] as any); // 2 events from source2

      // Stub raw query for duplicate removal
      sandbox.stub(db, 'query').resolves([]);

      sandbox.stub(EventCategoryContentEntity, 'destroy').resolves(2);
      sandbox.stub(EventCategoryEntity, 'destroy').resolves(2);

      const result = await categoryService.mergeCategories(
        testAccount,
        'calendar-123',
        'category-target',
        ['category-source1', 'category-source2']
      );

      expect(result.totalAffectedEvents).toBe(5);
      expect(updateStub.callCount).toBe(2);
      expect(mockTransaction.commit.calledOnce).toBeTruthy();
    });

    it('should throw error if target is in source list', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      await expect(
        categoryService.mergeCategories(
          testAccount,
          'calendar-123',
          'category-target',
          ['category-source', 'category-target']
        )
      ).rejects.toThrow('Target category cannot be in source categories list');
    });

    it('should throw error if categories belong to different calendars', async () => {
      const mockTargetCategory = new EventCategory('category-target', 'calendar-123');
      const mockSourceCategory = new EventCategory('category-source', 'different-calendar');

      const getCategoryStub = sandbox.stub(categoryService, 'getCategory');
      getCategoryStub.withArgs('category-target', 'calendar-123').resolves(mockTargetCategory);
      getCategoryStub.withArgs('category-source').resolves(mockSourceCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      await expect(
        categoryService.mergeCategories(
          testAccount,
          'calendar-123',
          'category-target',
          ['category-source']
        )
      ).rejects.toThrow('All categories must belong to the same calendar');
    });
  });

  describe('getCategoryStats', () => {
    it('should return event counts for all categories in calendar', async () => {
      const mockCategories = [
        { id: 'category-1' },
        { id: 'category-2' },
        { id: 'category-3' },
      ];

      sandbox.stub(EventCategoryEntity, 'findAll').resolves(mockCategories as any);

      const mockStats = [
        { category_id: 'category-1', event_count: '10' },
        { category_id: 'category-2', event_count: '5' },
      ];

      sandbox.stub(db, 'query').resolves(mockStats as any);

      const stats = await categoryService.getCategoryStats('calendar-123');

      expect(stats.size).toBe(3);
      expect(stats.get('category-1')).toBe(10);
      expect(stats.get('category-2')).toBe(5);
      expect(stats.get('category-3')).toBe(0);
    });

    it('should return empty map if no categories in calendar', async () => {
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([]);

      const stats = await categoryService.getCategoryStats('calendar-123');

      expect(stats.size).toBe(0);
    });
  });
});
