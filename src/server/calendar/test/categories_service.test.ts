import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import CategoryService from '../service/categories';
import CalendarService from '../service/calendar';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventCategory } from '@/common/model/event_category';
import { EventCategoryContent } from '@/common/model/event_category_content';
import { EventCategoryEntity } from '../entity/event_category';
import { EventCategoryContentEntity } from '../entity/event_category_content';
import { EventCategoryAssignmentEntity } from '../entity/event_category_assignment';
import { EventEntity } from '../entity/event';
import { CalendarNotFoundError, EventNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import {
  CategoryNotFoundError,
  CategoryAssignmentNotFoundError,
  CategoryAlreadyAssignedError,
  CategoryEventCalendarMismatchError,
} from '@/common/exceptions/category';

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
        content: {
          en: {
            name: 'Technology',
          },
        },
      };

      const category = await categoryService.createCategory(testAccount, 'calendar-123', categoryData);

      expect(category).toBeInstanceOf(EventCategory);
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
        content: {
          en: {
            name: 'Technology',
          },
        },
      };

      await expect(
        categoryService.createCategory(testAccount, 'non-existent-calendar', categoryData),
      ).rejects.toThrow(CalendarNotFoundError);
    });

    it('should throw error for unauthorized user', async () => {
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      const categoryData = {
        content: {
          en: {
            name: 'Technology',
          },
        },
      };

      await expect(
        categoryService.createCategory(testAccount, testCalendar.id, categoryData),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
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
      expect(categories[0]).toBeInstanceOf(EventCategory);
      expect(categories[1]).toBeInstanceOf(EventCategory);
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

      expect(category).toBeInstanceOf(EventCategory);
      expect(category?.id).toBe('category-123');
    });

    it('should throw error for non-existent category', async () => {
      sandbox.stub(EventCategoryEntity, 'findByPk').resolves(null);

      await expect(
        categoryService.getCategory('non-existent-id'),
      ).rejects.toThrow(CategoryNotFoundError);
    });
  });

  describe('updateCategory', () => {
    it('should update category content with permission checks', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
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
        content: {
          en: {
            name: 'Updated Technology',
          },
        },
      };

      // Mock the second getCategory call (after update)
      getStub.onSecondCall().resolves(new EventCategory('category-123', 'calendar-123'));

      const result = await categoryService.updateCategory(testAccount, 'category-123', updateData);

      expect(result).toBeInstanceOf(EventCategory);
      expect(saveStub.calledOnce).toBeTruthy();
      // Verify the permission checking was called
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });    it('should create new content when updating category with new language', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      const getStub = sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      // Setup permission checking mocks
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Simulate no existing content found
      sandbox.stub(EventCategoryContentEntity, 'findOne').resolves(null);

      // Stub the save method on prototype - this catches all content save calls
      const contentSaveStub = sandbox.stub(EventCategoryContentEntity.prototype, 'save');

      const updateData = {
        content: {
          es: {
            name: 'Tecnología',
          },
        },
      };

      // Mock the second getCategory call (after update)
      getStub.onSecondCall().resolves(new EventCategory('category-123', 'calendar-123'));

      const result = await categoryService.updateCategory(testAccount, 'category-123', updateData);

      expect(result).toBeInstanceOf(EventCategory);

      // Verify save was called for the new content entity
      expect(contentSaveStub.calledOnce).toBeTruthy();

      // Verify permission checking was called
      expect(mockCalendarService.getCalendar.called).toBeTruthy();
      expect(mockCalendarService.userCanModifyCalendar.called).toBeTruthy();
    });

    it('should throw error for non-existent category', async () => {
      sandbox.stub(categoryService, 'getCategory').rejects(new CategoryNotFoundError());

      const updateData = {
        content: {
          en: {
            name: 'Updated Technology',
          },
        },
      };

      await expect(
        categoryService.updateCategory(testAccount, 'category-123', updateData),
      ).rejects.toThrow(CategoryNotFoundError);
    });

    it('should throw error for unauthorized user', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      const updateData = {
        content: {
          en: {
            name: 'Updated Technology',
          },
        },
      };

      await expect(
        categoryService.updateCategory(testAccount, 'category-123', updateData),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('deleteCategory', () => {
    it('should delete category with permission checks', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
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

    it('should throw error for non-existent category', async () => {
      sandbox.stub(categoryService, 'getCategory').rejects(new CategoryNotFoundError());

      await expect(
        categoryService.deleteCategory(testAccount, 'category-123'),
      ).rejects.toThrow(CategoryNotFoundError);
    });

    it('should throw error for unauthorized user', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      await expect(
        categoryService.deleteCategory(testAccount, 'category-123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });
  });

  describe('assignCategoryToEvent', () => {
    it('should assign a category to an event', async () => {
      // Setup mocks
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      const content = new EventCategoryContent('en');
      content.name = 'Technology';
      mockCategory.addContent(content);

      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);
      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Mock event lookup
      const mockEventEntity = {
        calendar_id: 'calendar-123',
      };
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

      // Mock assignment lookup and creation
      sandbox.stub(EventCategoryAssignmentEntity, 'findOne').resolves(null);
      sandbox.stub(EventCategoryAssignmentEntity.prototype, 'save').resolves();

      const assignment = await categoryService.assignCategoryToEvent(
        testAccount,
        'event-123',
        'category-123',
      );

      expect(assignment).toBeDefined();
      expect(assignment.eventId).toBe('event-123');
      expect(assignment.categoryId).toBe('category-123');
    });

    it('should throw error if category not found', async () => {
      sandbox.stub(categoryService, 'getCategory').rejects(new CategoryNotFoundError());

      await expect(
        categoryService.assignCategoryToEvent(testAccount, 'event-123', 'category-123'),
      ).rejects.toThrow(CategoryNotFoundError);
    });

    it('should throw error if event not found', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);
      sandbox.stub(EventEntity, 'findByPk').resolves(null);

      await expect(
        categoryService.assignCategoryToEvent(testAccount, 'event-123', 'category-123'),
      ).rejects.toThrow(EventNotFoundError);
    });

    it('should throw error if event and category belong to different calendars', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      const mockEventEntity = {
        calendar_id: 'different-calendar',
      };
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

      await expect(
        categoryService.assignCategoryToEvent(testAccount, 'event-123', 'category-123'),
      ).rejects.toThrow(CategoryEventCalendarMismatchError);
    });

    it('should throw error if user lacks permission', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      const mockEventEntity = {
        calendar_id: 'calendar-123',
      };
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(false);

      await expect(
        categoryService.assignCategoryToEvent(testAccount, 'event-123', 'category-123'),
      ).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw error if assignment already exists', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      const mockEventEntity = {
        calendar_id: 'calendar-123',
      };
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Mock existing assignment
      const mockAssignment = {};
      sandbox.stub(EventCategoryAssignmentEntity, 'findOne').resolves(mockAssignment as any);

      await expect(
        categoryService.assignCategoryToEvent(testAccount, 'event-123', 'category-123'),
      ).rejects.toThrow(CategoryAlreadyAssignedError);
    });
  });

  describe('unassignCategoryFromEvent', () => {
    it('should remove a category assignment from an event', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      const mockEventEntity = {
        calendar_id: 'calendar-123',
      };
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Mock successful deletion
      sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(1);

      await categoryService.unassignCategoryFromEvent(testAccount, 'event-123', 'category-123');

      // Should not throw
      expect(true).toBe(true);
    });

    it('should throw error if assignment not found', async () => {
      const mockCategory = new EventCategory('category-123', 'calendar-123');
      sandbox.stub(categoryService, 'getCategory').resolves(mockCategory);

      const mockEventEntity = {
        calendar_id: 'calendar-123',
      };
      sandbox.stub(EventEntity, 'findByPk').resolves(mockEventEntity as any);

      mockCalendarService.getCalendar.resolves(testCalendar);
      mockCalendarService.userCanModifyCalendar.resolves(true);

      // Mock no deletion (assignment not found)
      sandbox.stub(EventCategoryAssignmentEntity, 'destroy').resolves(0);

      await expect(
        categoryService.unassignCategoryFromEvent(testAccount, 'event-123', 'category-123'),
      ).rejects.toThrow(CategoryAssignmentNotFoundError);
    });
  });

  describe('getEventCategories', () => {
    it('should return all categories for an event', async () => {
      const mockCategoryEntity = {
        toModel: () => {
          const model = new EventCategory('category-123', 'calendar-123');
          const content = new EventCategoryContent('en');
          content.name = 'Technology';
          model.addContent(content);
          return model;
        },
      };

      const mockAssignments = [
        { category: mockCategoryEntity },
      ];

      sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves(mockAssignments as any);

      const categories = await categoryService.getEventCategories('event-123');

      expect(categories).toHaveLength(1);
      expect(categories[0].id).toBe('category-123');
      expect(categories[0].content('en').name).toBe('Technology');
    });

    it('should return empty array if no categories assigned', async () => {
      sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves([]);

      const categories = await categoryService.getEventCategories('event-123');

      expect(categories).toHaveLength(0);
    });
  });

  describe('getCategoryEvents', () => {
    it('should return all event IDs for a category', async () => {
      const mockAssignments = [
        { event_id: 'event-123' },
        { event_id: 'event-456' },
      ];

      sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves(mockAssignments as any);

      const eventIds = await categoryService.getCategoryEvents('category-123');

      expect(eventIds).toHaveLength(2);
      expect(eventIds).toContain('event-123');
      expect(eventIds).toContain('event-456');
    });

    it('should return empty array if no events assigned', async () => {
      sandbox.stub(EventCategoryAssignmentEntity, 'findAll').resolves([]);

      const eventIds = await categoryService.getCategoryEvents('category-123');

      expect(eventIds).toHaveLength(0);
    });
  });
});
