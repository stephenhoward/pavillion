import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import CategoryService from '@/client/service/category';
import ModelService from '@/client/service/models';
import { EventCategory } from '@/common/model/event_category';
import { CategoryNotFoundError } from '@/common/exceptions/category';
import { CalendarNotFoundError, InsufficientCalendarPermissionsError } from '@/common/exceptions/calendar';
import { UnknownError } from '@/common/exceptions';
import { useCategoryStore } from '@/client/stores/categoryStore';

// Mock axios
vi.mock('axios');

describe('CategoryService', () => {
  const sandbox = sinon.createSandbox();
  let mockStore: ReturnType<typeof useCategoryStore>;
  let service: CategoryService;

  beforeEach(() => {
    // Create a mock store before each test
    mockStore = {
      categories: {},
      addCategory: sandbox.stub(),
      updateCategory: sandbox.stub(),
      setCategoriesForCalendar: sandbox.stub(),
      removeCategory: sandbox.stub(),
    };
    // Create service with mock store
    service = new CategoryService(mockStore);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('loadCategories', () => {
    it('should load categories for a calendar', async () => {
      const mockCategoryData = {
        id: 'cat-123',
        calendarId: 'cal-123',
        eventCount: 5,
        content: {
          en: { language: 'en', name: 'Test Category' },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: [mockCategoryData] });

      const categories = await service.loadCategories('cal-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/calendars/cal-123/categories')).toBe(true);
      expect(categories).toHaveLength(1);
      expect(categories[0]).toBeInstanceOf(EventCategory);
      expect(mockStore.setCategoriesForCalendar.calledWith('cal-123', categories)).toBe(true);
    });

    it('should handle errors and log them', async () => {
      const axiosGetStub = sandbox.stub(axios, 'get');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      axiosGetStub.rejects(testError);

      await expect(service.loadCategories('cal-123')).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error loading calendar categories:', testError)).toBe(true);
    });
  });

  describe('saveCategory', () => {
    it('should create a new category', async () => {
      const category = new EventCategory('', 'cal-123');
      category.content('en').name = 'New Category';

      const mockResponseData = {
        id: 'cat-123',
        calendarId: 'cal-123',
        content: {
          en: { language: 'en', name: 'New Category' },
        },
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.resolves(mockResponseData);

      const result = await service.saveCategory(category);

      expect(mockCreateModel.calledOnce).toBe(true);
      expect(mockCreateModel.calledWith(category, '/api/v1/calendars/cal-123/categories')).toBe(true);
      expect(result).toBeInstanceOf(EventCategory);
      expect(mockStore.addCategory.calledWith('cal-123', result)).toBe(true);
    });

    it('should update an existing category', async () => {
      const category = new EventCategory('cat-123', 'cal-123');
      category.content('en').name = 'Updated Category';

      const mockResponseData = {
        id: 'cat-123',
        calendarId: 'cal-123',
        content: {
          en: { language: 'en', name: 'Updated Category' },
        },
      };

      const mockUpdateModel = sandbox.stub(ModelService, 'updateModel');
      mockUpdateModel.resolves(mockResponseData);

      const result = await service.saveCategory(category);

      expect(mockUpdateModel.calledOnce).toBe(true);
      expect(mockUpdateModel.calledWith(category, '/api/v1/calendars/cal-123/categories')).toBe(true);
      expect(result).toBeInstanceOf(EventCategory);
      expect(mockStore.updateCategory.calledWith('cal-123', result)).toBe(true);
    });

    it('should throw error if category has no calendarId', async () => {
      const category = new EventCategory('', '');

      await expect(service.saveCategory(category)).rejects.toThrow('Category must have a calendarId');
    });

    it('should handle API errors', async () => {
      const category = new EventCategory('', 'cal-123');
      category.content('en').name = 'New Category';

      const mockError = {
        response: {
          data: {
            errorName: 'CalendarNotFoundError',
          },
        },
      };

      const mockCreateModel = sandbox.stub(ModelService, 'createModel');
      mockCreateModel.rejects(mockError);

      await expect(service.saveCategory(category)).rejects.toThrow(CalendarNotFoundError);
    });
  });

  describe('getCategory', () => {
    it('should get a specific category', async () => {
      const mockCategoryData = {
        category: {
          id: 'cat-123',
          calendarId: 'cal-123',
          content: {
            en: { language: 'en', name: 'Specific Category' },
          },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.resolves({ data: mockCategoryData.category });

      const category = await service.getCategory('cat-123', 'cal-123');

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/calendars/cal-123/categories/cat-123')).toBe(true);
      expect(category).toBeInstanceOf(EventCategory);
    });

    it('should handle CategoryNotFoundError', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CategoryNotFoundError',
          },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getCategory('cat-123', 'cal-123')).rejects.toThrow(CategoryNotFoundError);
    });
  });

  describe('deleteCategory', () => {
    it('should delete a category', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: { affectedEventCount: 0 } });

      await service.deleteCategory('cat-123', 'cal-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/calendars/cal-123/categories/cat-123')).toBe(true);
    });

    it('should handle delete errors', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CategoryNotFoundError',
          },
        },
      };

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.deleteCategory('cat-123', 'cal-123')).rejects.toThrow(CategoryNotFoundError);
    });

    it('should remove category from store when calendarId provided', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves({ data: { affectedEventCount: 5 } });

      await service.deleteCategory('cat-123', 'cal-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/calendars/cal-123/categories/cat-123')).toBe(true);
      expect(mockStore.removeCategory.calledWith('cal-123', 'cat-123')).toBe(true);
    });
  });

  describe('getEventCategories', () => {
    it('should get categories for an event', async () => {
      const mockCategoryData = {
        id: 'cat-123',
        calendarId: 'cal-123',
        content: {
          en: { language: 'en', name: 'Event Category' },
        },
      };

      const mockListModels = sandbox.stub(ModelService, 'listModels');
      mockListModels.resolves([mockCategoryData]);

      const categories = await service.getEventCategories('event-123');

      expect(mockListModels.calledOnce).toBe(true);
      expect(mockListModels.calledWith('/api/v1/events/event-123/categories')).toBe(true);
      expect(categories).toHaveLength(1);
      expect(categories[0]).toBeInstanceOf(EventCategory);
    });

    it('should handle errors and log them', async () => {
      const mockListModels = sandbox.stub(ModelService, 'listModels');
      const consoleErrorStub = sandbox.stub(console, 'error');
      const testError = new Error('API Error');

      mockListModels.rejects(testError);

      await expect(service.getEventCategories('event-123')).rejects.toThrow('API Error');
      expect(consoleErrorStub.calledWith('Error loading event categories:', testError)).toBe(true);
    });

    it('should URL-encode event IDs with special characters', async () => {
      const eventIdWithUrl = 'https://pavillion.dev/events/event-123';
      const encodedEventId = encodeURIComponent(eventIdWithUrl);
      const mockCategoryData = {
        id: 'cat-123',
        calendarId: 'cal-123',
        content: {
          en: { language: 'en', name: 'Event Category' },
        },
      };

      const mockListModels = sandbox.stub(ModelService, 'listModels');
      mockListModels.resolves([mockCategoryData]);

      await service.getEventCategories(eventIdWithUrl);

      expect(mockListModels.calledOnce).toBe(true);
      expect(mockListModels.calledWith(`/api/v1/events/${encodedEventId}/categories`)).toBe(true);
    });
  });

  describe('assignCategoryToEvent', () => {
    it('should assign a category to an event', async () => {
      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves();

      await service.assignCategoryToEvent('event-123', 'cat-123');

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith('/api/v1/events/event-123/categories/cat-123')).toBe(true);
    });

    it('should handle assignment errors', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CategoryNotFoundError',
          },
        },
      };

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.rejects(mockError);

      await expect(service.assignCategoryToEvent('event-123', 'cat-123')).rejects.toThrow(CategoryNotFoundError);
    });

    it('should URL-encode event IDs in assignment', async () => {
      const eventIdWithUrl = 'https://pavillion.dev/events/event-123';
      const encodedEventId = encodeURIComponent(eventIdWithUrl);

      const axiosPostStub = sandbox.stub(axios, 'post');
      axiosPostStub.resolves();

      await service.assignCategoryToEvent(eventIdWithUrl, 'cat-123');

      expect(axiosPostStub.calledOnce).toBe(true);
      expect(axiosPostStub.calledWith(`/api/v1/events/${encodedEventId}/categories/cat-123`)).toBe(true);
    });
  });

  describe('unassignCategoryFromEvent', () => {
    it('should unassign a category from an event', async () => {
      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves();

      await service.unassignCategoryFromEvent('event-123', 'cat-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith('/api/v1/events/event-123/categories/cat-123')).toBe(true);
    });

    it('should handle unassignment errors', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'CategoryNotFoundError',
          },
        },
      };

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.rejects(mockError);

      await expect(service.unassignCategoryFromEvent('event-123', 'cat-123')).rejects.toThrow(CategoryNotFoundError);
    });

    it('should URL-encode event IDs in unassignment', async () => {
      const eventIdWithUrl = 'https://pavillion.dev/events/event-123';
      const encodedEventId = encodeURIComponent(eventIdWithUrl);

      const axiosDeleteStub = sandbox.stub(axios, 'delete');
      axiosDeleteStub.resolves();

      await service.unassignCategoryFromEvent(eventIdWithUrl, 'cat-123');

      expect(axiosDeleteStub.calledOnce).toBe(true);
      expect(axiosDeleteStub.calledWith(`/api/v1/events/${encodedEventId}/categories/cat-123`)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle known error types correctly', async () => {
      const mockError = {
        response: {
          data: {
            errorName: 'InsufficientCalendarPermissionsError',
          },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getCategory('cat-123', 'cal-123')).rejects.toThrow(InsufficientCalendarPermissionsError);
    });

    it('should throw UnknownError for unrecognized errors', async () => {
      const mockError = new Error('Unknown error');
      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getCategory('cat-123', 'cal-123')).rejects.toThrow(UnknownError);
    });

    it('should handle malformed error responses', async () => {
      const mockError = {
        response: {
          data: {
            // Missing errorName
          },
        },
      };

      const axiosGetStub = sandbox.stub(axios, 'get');
      axiosGetStub.rejects(mockError);

      await expect(service.getCategory('cat-123', 'cal-123')).rejects.toThrow(UnknownError);
    });
  });
});
