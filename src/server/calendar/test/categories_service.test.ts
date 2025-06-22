import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CategoryService from '../service/categories';
import CalendarService from '../service/calendar';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventCategoryModel } from '@/common/model/event_category';
import { EventCategoryEntity } from '../entity/event_category';
import { EventCategoryContentEntity } from '../entity/event_category_content';

describe('CategoryService', () => {
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

  describe('createCategory', () => {
    it('should create a new category with content', async () => {
      // Setup mocks for permission checking
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Stub the save methods on prototypes - this catches all save calls
      const categorySaveStub = sandbox.stub(EventCategoryEntity.prototype, 'save');
      const contentSaveStub = sandbox.stub(EventCategoryContentEntity.prototype, 'save');

      const categoryData = {
        name: 'Technology',
        language: 'en',
      };

      const category = await categoryService.createCategory(testAccount, 'calendar-123', categoryData);

      expect(category).toBeInstanceOf(EventCategoryModel);
      expect(category.calendarId).toBe('calendar-123');

      // Verify save was called on both entities
      expect(categorySaveStub.calledOnce).toBeTruthy();
      expect(contentSaveStub.calledOnce).toBeTruthy();

      // Verify permission checking was called
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw error for non-existent calendar', async () => {
      mockCalendarService.getCalendar.resolves(null);

      const categoryData = {
        name: 'Technology',
        language: 'en',
      };

      await expect(
        categoryService.createCategory(testAccount, 'non-existent-calendar', categoryData),
      ).rejects.toThrow('Calendar not found');
    });

    it('should throw error for unauthorized user', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      const categoryData = {
        name: 'Technology',
        language: 'en',
      };

      await expect(
        categoryService.createCategory(testAccount, testCalendar.id, categoryData),
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('getCategories', () => {
    it('should return all categories for a calendar', async () => {
      const mockEntity1 = EventCategoryEntity.build({
        id: 'category-1',
        calendar_id: 'calendar-123',
      });

      const mockEntity2 = EventCategoryEntity.build({
        id: 'category-2',
        calendar_id: 'calendar-123',
      });

      const mockContent1 = EventCategoryContentEntity.build({
        category_id: 'category-1',
        language: 'en',
        name: 'Technology',
      });

      const mockContent2 = EventCategoryContentEntity.build({
        category_id: 'category-2',
        language: 'en',
        name: 'Business',
      });

      mockEntity1.content = [mockContent1];
      mockEntity2.content = [mockContent2];

      sandbox.stub(EventCategoryEntity, 'findAll').resolves([mockEntity1, mockEntity2]);

      const categories = await categoryService.getCategories('calendar-123');

      expect(categories).toHaveLength(2);
      expect(categories[0]).toBeInstanceOf(EventCategoryModel);
      expect(categories[1]).toBeInstanceOf(EventCategoryModel);
    });

    it('should return empty array for calendar with no categories', async () => {
      sandbox.stub(EventCategoryEntity, 'findAll').resolves([]);

      const categories = await categoryService.getCategories('calendar-123');
      expect(categories).toHaveLength(0);
    });
  });

  describe('getCategory', () => {
    it('should return a specific category', async () => {
      const mockEntity = EventCategoryEntity.build({
        id: 'category-123',
        calendar_id: 'calendar-123',
      });

      const mockContent = EventCategoryContentEntity.build({
        category_id: 'category-123',
        language: 'en',
        name: 'Technology',
      });

      mockEntity.content = [mockContent];

      sandbox.stub(EventCategoryEntity, 'findByPk').resolves(mockEntity);

      const category = await categoryService.getCategory('category-123');

      expect(category).toBeInstanceOf(EventCategoryModel);
      expect(category?.id).toBe('category-123');
    });

    it('should return null for non-existent category', async () => {
      sandbox.stub(EventCategoryEntity, 'findByPk').resolves(null);

      const category = await categoryService.getCategory('non-existent-id');
      expect(category).toBeNull();
    });
  });

  describe('updateCategory', () => {
    it('should update category content with permission checks', async () => {
      const mockCategory = new EventCategoryModel('category-123', 'calendar-123');
      const getStub = sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      // Setup permission checking mocks
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      const mockContentEntity = EventCategoryContentEntity.build({
        category_id: 'category-123',
        language: 'en',
        name: 'Updated Technology',
      });

      sandbox.stub(EventCategoryContentEntity, 'findOne').resolves(mockContentEntity);
      const saveStub = sandbox.stub(mockContentEntity, 'save').resolves(mockContentEntity);

      const updateData = {
        name: 'Updated Technology',
        language: 'en',
      };

      // Mock the second getCategory call (after update)
      getStub.onSecondCall().resolves(new EventCategoryModel('category-123', 'calendar-123'));

      const result = await categoryService.updateCategory(testAccount, 'category-123', updateData);

      expect(result).toBeInstanceOf(EventCategoryModel);
      expect(saveStub.calledOnce).toBeTruthy();
      // Verify the permission checking was called
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });    it('should create new content when updating category with new language', async () => {
      const mockCategory = new EventCategoryModel('category-123', 'calendar-123');
      const getStub = sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      // Setup permission checking mocks
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Simulate no existing content found
      sandbox.stub(EventCategoryContentEntity, 'findOne').resolves(null);

      // Stub the save method on prototype - this catches all content save calls
      const contentSaveStub = sandbox.stub(EventCategoryContentEntity.prototype, 'save');

      const updateData = {
        name: 'Tecnología',
        language: 'es',
      };

      // Mock the second getCategory call (after update)
      getStub.onSecondCall().resolves(new EventCategoryModel('category-123', 'calendar-123'));

      const result = await categoryService.updateCategory(testAccount, 'category-123', updateData);

      expect(result).toBeInstanceOf(EventCategoryModel);

      // Verify save was called for the new content entity
      expect(contentSaveStub.calledOnce).toBeTruthy();

      // Verify permission checking was called
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw error for unauthorized user', async () => {
      const mockCategory = new EventCategoryModel('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      const updateData = {
        name: 'Updated Technology',
        language: 'en',
      };

      await expect(
        categoryService.updateCategory(testAccount, 'category-123', updateData),
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('deleteCategory', () => {
    it('should delete category with permission checks', async () => {
      const mockCategory = new EventCategoryModel('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      // Setup permission checking mocks
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      sandbox.stub(EventCategoryContentEntity, 'destroy').resolves(1);
      sandbox.stub(EventCategoryEntity, 'destroy').resolves(1);

      await categoryService.deleteCategory(testAccount, 'category-123');

      // Verify the permission checking was called
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw error for unauthorized user', async () => {
      const mockCategory = new EventCategoryModel('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      await expect(
        categoryService.deleteCategory(testAccount, 'category-123'),
      ).rejects.toThrow('Permission denied');
    });
  });
});
